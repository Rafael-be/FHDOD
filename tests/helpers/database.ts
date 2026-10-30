/**
 * Permits integration tests only against an explicitly named local disposable
 * database. A different remote host is not a safety boundary.
 */
export function usesIsolatedDatabase(
  testUrl: string | undefined,
  runtimeUrl: string | undefined,
): boolean {
  if (!testUrl || !runtimeUrl) {
    return false;
  }

  try {
    const testDatabase = new URL(testUrl);
    const runtimeDatabase = new URL(runtimeUrl);

    const localHost = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(testDatabase.hostname);
    const dedicatedName = /^\/fhdod_test(?:_|$)/.test(testDatabase.pathname);

    return localHost
      && dedicatedName
      && (testDatabase.hostname !== runtimeDatabase.hostname
      || testDatabase.port !== runtimeDatabase.port
      || testDatabase.pathname !== runtimeDatabase.pathname);
  } catch {
    return false;
  }
}

/** LOCAL_DATABASE_URL is reserved for the disposable loopback integration DB. */
export function testDatabaseUrl(): string | undefined {
  return process.env.LOCAL_DATABASE_URL ?? process.env.DATABASE_URL_TEST;
}
