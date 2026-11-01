import postgres from "postgres";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const testDatabasePath = "/fhdod_test";
const defaultPostgresPort = "5432";
const disposableMarker = "fhdod.disposable";

export function postgresIntegrationTestsEnabled(): boolean {
  return process.env.POSTGRES_INTEGRATION_TESTS === "true";
}

function hasApprovedTestDatabase(url: URL): boolean {
  return url.pathname === testDatabasePath;
}

function effectivePort(url: URL): string {
  return url.port || defaultPostgresPort;
}

/**
 * Permits integration tests only when both connections address the same
 * explicitly named local test database. URL shape is a pre-connection guard;
 * tests that need the stronger database marker must call
 * assertDisposableTestDatabase before their first mutation.
 */
export function usesIsolatedDatabase(
  testUrl: string | undefined,
  runtimeUrl: string | undefined,
): boolean {
  if (!postgresIntegrationTestsEnabled() || !testUrl || !runtimeUrl) {
    return false;
  }

  try {
    const testDatabase = new URL(testUrl);
    const runtimeDatabase = new URL(runtimeUrl);

    const testHostIsLocal = localHosts.has(testDatabase.hostname);
    const runtimeHostIsLocal = localHosts.has(runtimeDatabase.hostname);

    return testHostIsLocal
      && runtimeHostIsLocal
      && hasApprovedTestDatabase(testDatabase)
      && hasApprovedTestDatabase(runtimeDatabase)
      && testDatabase.hostname === runtimeDatabase.hostname
      && effectivePort(testDatabase) === effectivePort(runtimeDatabase)
      && testDatabase.pathname === runtimeDatabase.pathname
      && decodeURIComponent(runtimeDatabase.username) === "fhdod_api";
  } catch {
    return false;
  }
}

export function hasDisposableMarker(
  adminState: { database: string; marker: string | null } | undefined,
  runtimeState: { database: string; role: string; marker: string | null } | undefined,
): boolean {
  return adminState?.database === "fhdod_test"
    && runtimeState?.database === "fhdod_test"
    && runtimeState?.role === "fhdod_api"
    && adminState?.marker === "true"
    && runtimeState?.marker === "true";
}

/**
 * Verifies a marker installed only while provisioning a disposable database.
 * It never creates the marker and runs only read-only catalog expressions.
 */
export async function assertDisposableTestDatabase(
  testUrl: string,
  runtimeUrl: string,
): Promise<void> {
  if (!usesIsolatedDatabase(testUrl, runtimeUrl)) {
    throw new Error("Banco de integração não atende ao contrato local descartável.");
  }

  const admin = postgres(testUrl, { max: 1 });
  const runtime = postgres(runtimeUrl, { max: 1 });
  try {
    const [adminState] = await admin<{ database: string; marker: string | null }[]>`
      select current_database() as database,
             current_setting(${disposableMarker}, true) as marker
    `;
    const [runtimeState] = await runtime<{ database: string; role: string; marker: string | null }[]>`
      select current_database() as database,
             current_user as role,
             current_setting(${disposableMarker}, true) as marker
    `;

    if (!hasDisposableMarker(adminState, runtimeState)) {
      throw new Error("Banco de integração não possui o marcador descartável aprovado.");
    }
  } finally {
    await Promise.all([admin.end({ timeout: 5 }), runtime.end({ timeout: 5 })]);
  }
}

/** LOCAL_DATABASE_URL is reserved for the disposable loopback integration DB. */
export function testDatabaseUrl(): string | undefined {
  return process.env.LOCAL_DATABASE_URL ?? process.env.DATABASE_URL_TEST;
}
