import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabaseUrl } from "../../lib/config/test-database";

describe("custom agent RLS", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assertSafeIntegrationDatabaseUrl(connectionString, process.env.ALLOW_TEST_DATABASE_RESET);
  const sql = postgres(connectionString, { max: 2 });
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    await sql`insert into public.users (id) values (${userA}), (${userB})`;
  });
  afterAll(async () => {
    await sql`delete from public.users where id in (${userA}, ${userB})`;
    await sql.end();
  });

  it("creates provider_configs, agents, and nullable conversation snapshot columns", async () => {
    const tables = await sql`select tablename from pg_tables where schemaname = 'public' and tablename in ('provider_configs', 'agents')`;
    expect(tables).toHaveLength(2);
    const columns = await sql`select column_name from information_schema.columns where table_name = 'conversations' and column_name = 'routing_kind'`;
    expect(columns).toHaveLength(1);
  });
});
