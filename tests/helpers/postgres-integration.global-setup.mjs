import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import postgres from "postgres";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function integrationTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return integrationTestFiles(path);
    return entry.name.endsWith(".integration.test.ts") ? [path] : [];
  });
}

function assertPostgresSuitesUseTheCentralGuard() {
  const unguarded = integrationTestFiles(join(process.cwd(), "tests"))
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return source.includes("postgres(") && !source.includes("usesIsolatedDatabase(");
    });
  if (unguarded.length > 0) {
    throw new Error(
      `Suites PostgreSQL sem o guard central: ${unguarded.join(", ")}`,
    );
  }
}

function effectivePort(url) {
  return url.port || "5432";
}

function validUrls(adminUrl, runtimeUrl) {
  if (!adminUrl || !runtimeUrl) return false;
  try {
    const admin = new URL(adminUrl);
    const runtime = new URL(runtimeUrl);
    return localHosts.has(admin.hostname)
      && localHosts.has(runtime.hostname)
      && admin.hostname === runtime.hostname
      && effectivePort(admin) === effectivePort(runtime)
      && admin.pathname === "/fhdod_test"
      && runtime.pathname === "/fhdod_test"
      && decodeURIComponent(runtime.username) === "fhdod_api";
  } catch {
    return false;
  }
}

export default async function setupPostgresIntegrationTests() {
  assertPostgresSuitesUseTheCentralGuard();
  if (process.env.POSTGRES_INTEGRATION_TESTS !== "true") return;

  const adminUrl = process.env.LOCAL_DATABASE_URL ?? process.env.DATABASE_URL_TEST;
  const runtimeUrl = process.env.DATABASE_URL;
  if (!validUrls(adminUrl, runtimeUrl)) {
    throw new Error("POSTGRES_INTEGRATION_TESTS=true exige URLs locais compatíveis para fhdod_test.");
  }

  const admin = postgres(adminUrl, { max: 1 });
  const runtime = postgres(runtimeUrl, { max: 1 });
  try {
    const [adminState] = await admin`select current_database() as database, current_setting('fhdod.disposable', true) as marker`;
    const [runtimeState] = await runtime`select current_database() as database, current_user as role, current_setting('fhdod.disposable', true) as marker`;
    if (
      adminState?.database !== "fhdod_test"
      || runtimeState?.database !== "fhdod_test"
      || runtimeState?.role !== "fhdod_api"
      || adminState?.marker !== "true"
      || runtimeState?.marker !== "true"
    ) {
      throw new Error("Banco de integração não possui o marcador descartável aprovado.");
    }
  } finally {
    await Promise.all([admin.end({ timeout: 5 }), runtime.end({ timeout: 5 })]);
  }
}
