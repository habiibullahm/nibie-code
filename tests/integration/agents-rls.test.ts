import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabaseUrl } from "../../lib/config/test-database";

describe("custom agent RLS", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assertSafeIntegrationDatabaseUrl(connectionString, process.env.ALLOW_TEST_DATABASE_RESET);
  const sql = postgres(connectionString, { max: 4 });
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    await sql`create schema if not exists auth`;
    await sql`create table if not exists auth.users (id uuid primary key)`;
    await sql`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$`;
    await sql`do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$`;
    await sql`do $$ begin create role anon nologin; exception when duplicate_object then null; end $$`;
    await sql`do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$`;
    await sql`grant usage on schema auth, public to authenticated`;
    await sql`create schema if not exists extensions`;
    await sql`create extension if not exists vector with schema extensions`;
    // Supabase grants this before a migration runs. The secret-column test is meaningless without it.
    await sql`alter default privileges in schema public grant all on tables to anon, authenticated, service_role`;
    await migrate(drizzle(sql), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    await sql`insert into auth.users (id) values (${userA}), (${userB}) on conflict (id) do nothing`;
  });

  afterAll(async () => {
    await sql`alter default privileges in schema public revoke all on tables from anon, authenticated, service_role`;
    await sql`delete from auth.users where id in (${userA}, ${userB})`;
    await sql.end();
  });

  async function insertProvider(userId: string, name: string) {
    const id = randomUUID();
    await sql`insert into public.provider_configs (id, user_id, provider_type, name, base_url, secret_ciphertext, key_hint)
      values (${id}, ${userId}, 'openai_compatible', ${name}, 'https://example.com/v1', 'v1.cipher', 'ab12')`;
    return id;
  }

  it("creates provider_configs, agents, and nullable conversation snapshot columns", async () => {
    const tables = await sql`select tablename from pg_tables where schemaname = 'public' and tablename in ('provider_configs', 'agents')`;
    expect(tables).toHaveLength(2);
    const columns = await sql`select column_name from information_schema.columns where table_name = 'conversations' and column_name = 'routing_kind'`;
    expect(columns).toHaveLength(1);
  });

  it("lets the owner read a safe column and hides the ciphertext", async () => {
    const id = await insertProvider(userA, "Readable");
    const [privilege] = await sql`select has_column_privilege('authenticated', 'public.provider_configs', 'secret_ciphertext', 'SELECT') as allowed`;
    expect(privilege.allowed).toBe(false);
    const names = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${userA}, true)`;
      return tx`select name from public.provider_configs where id = ${id}`;
    });
    expect(names).toEqual([{ name: "Readable" }]);
    await expect(sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${userA}, true)`;
      return tx`select secret_ciphertext from public.provider_configs where id = ${id}`;
    })).rejects.toMatchObject({ code: "42501" });
  });

  it("deletes a user who still has an agent on a provider config", async () => {
    const userId = randomUUID();
    const providerId = randomUUID();
    const agentId = randomUUID();
    await sql`insert into auth.users (id) values (${userId})`;
    await sql`insert into public.provider_configs (id, user_id, provider_type, name, base_url, secret_ciphertext, key_hint)
      values (${providerId}, ${userId}, 'openai_compatible', 'Kept', 'https://example.com/v1', 'v1.cipher', 'ab12')`;
    await sql`insert into public.agents (id, user_id, name, provider_binding, provider_config_id, model)
      values (${agentId}, ${userId}, 'Coding', 'explicit', ${providerId}, 'deepseek-chat')`;
    await sql`delete from auth.users where id = ${userId}`;
    const left = await sql`select id from public.users where id = ${userId}`;
    expect(left).toEqual([]);
  });

  it("stops the eleventh provider config for one user", async () => {
    const userId = randomUUID();
    await sql`insert into auth.users (id) values (${userId})`;
    for (let i = 0; i < 9; i += 1) await insertProvider(userId, `Cap ${i}`);
    const results = await Promise.allSettled([insertProvider(userId, "Cap 9"), insertProvider(userId, "Cap 10")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [count] = await sql`select count(*)::int as n from public.provider_configs where user_id = ${userId}`;
    expect(count.n).toBe(10);
    await sql`delete from auth.users where id = ${userId}`;
  });

  it("rejects a loopback base URL and a provider pin on an old chat", async () => {
    await expect(sql`insert into public.provider_configs (user_id, provider_type, name, base_url, secret_ciphertext, key_hint)
      values (${userA}, 'openai_compatible', 'Local', 'https://127.0.0.1/v1', 'v1.cipher', 'ab12')`).rejects.toMatchObject({ code: "23514" });
    const providerId = await insertProvider(userA, "Public");
    await expect(sql`insert into public.conversations (user_id, provider_config_id) values (${userA}, ${providerId})`).rejects.toMatchObject({ code: "23514" });
  });
});
