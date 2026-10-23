/**
 * Prevents integration tests from running when the runtime and test URLs point
 * to the same PostgreSQL database, even if their credentials differ.
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

    return testDatabase.hostname !== runtimeDatabase.hostname
      || testDatabase.port !== runtimeDatabase.port
      || testDatabase.pathname !== runtimeDatabase.pathname;
  } catch {
    return false;
  }
}
