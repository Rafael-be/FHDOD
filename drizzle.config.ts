import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Full catalog snapshot source. Application-focused schemas remain separate
  // and must not be globbed here, otherwise duplicate table definitions make
  // future diffs unsafe.
  schema: "./src/db/schema/baseline.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATIONS ?? "" },
  schemaFilter: ["public"],
  tablesFilter: ["*"],
});
