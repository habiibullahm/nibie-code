const TEST_DATABASE_NAME = "nibie_ai";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertSafeIntegrationDatabaseUrl(
  connectionString: string | undefined,
  allowReset: string | undefined,
): asserts connectionString is string {
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL is required for the RLS integration suite.");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error("RLS integration tests may only reset a PostgreSQL database on a loopback host.");
  }

  if (url.pathname !== `/${TEST_DATABASE_NAME}`) {
    throw new Error(`RLS integration tests may only reset the dedicated ${TEST_DATABASE_NAME} database.`);
  }

  if (allowReset !== "1") {
    throw new Error("Set ALLOW_TEST_DATABASE_RESET=1 to opt in to destructive local RLS integration tests.");
  }
}
