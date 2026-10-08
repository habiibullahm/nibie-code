import { vector } from "../fixtures/files-v3";
import { fuseRoomFileCandidates, type Candidate } from "../../lib/files/hybrid";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type TransactionSql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { assertSafeIntegrationDatabaseUrl } from "../../lib/config/test-database";
import { buildConversationExport, type ExportConversationRow, type ExportMessageRow } from "../../lib/privacy/export";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Supabase row-level security", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assertSafeIntegrationDatabaseUrl(connectionString, process.env.ALLOW_TEST_DATABASE_RESET);

  const sql = postgres(connectionString, { max: 3 });
  const db = drizzle(sql);
  const userA = randomUUID();
  const userB = randomUUID();
  const conversationA = randomUUID();
  const conversationB = randomUUID();
  const messageB = randomUUID();

  async function asUser<T>(userId: string, callback: (tx: TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
      await tx`select set_config('request.jwt.claim.role', 'authenticated', true)`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
      return callback(tx);
    });
  }

  /** Trusted Action Runtime boundary: service_role JWT (not a browser user). */
  async function asServiceRole<T>(callback: (tx: TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`set local role service_role`;
      await tx`select set_config('request.jwt.claim.role', 'service_role', true)`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "service_role" })}, true)`;
      return callback(tx);
    });
  }

  async function createUsageUser() {
    const id = randomUUID();
    await sql`insert into auth.users (id) values (${id})`;
    return id;
  }

  async function createGeneration(userId: string) {
    const conversationId = randomUUID();
    const userMessageId = randomUUID();
    const generationId = randomUUID();
    await sql`insert into public.conversations (id, user_id, title) values (${conversationId}, ${userId}, 'Usage test')`;
    await sql`insert into public.messages (id, conversation_id, user_id, role, content, position) values
      (${userMessageId}, ${conversationId}, ${userId}, 'user', 'test question', 1),
      (${generationId}, ${conversationId}, ${userId}, 'assistant', '…', 2)`;
    await sql`update public.messages set status = 'streaming' where id = ${generationId}`;
    return generationId;
  }

  async function reserveUsage(
    userId: string,
    generationId: string,
    mode: "Fast" | "Balanced" | "High",
    usageKind: "chat" | "research" = "chat",
  ) {
    return asUser(userId, (tx) => tx`
      select * from public.reserve_weekly_ai_usage(
        ${generationId}::uuid,
        ${mode}::public.weekly_usage_mode,
        ${usageKind}::text
      )
    `);
  }

  async function startUsage(userId: string, generationId: string) {
    return asUser(userId, (tx) => tx`select public.start_weekly_ai_usage(${generationId}::uuid) as started`);
  }

  async function reserveSpend(
    userId: string,
    generationId: string,
    reservedMicros: number,
    userDailyLimit: number,
    globalHourlyLimit: number,
  ) {
    return asServiceRole((tx) => tx`
      select * from public.reserve_ai_spend(
        ${userId}::uuid,
        ${generationId}::uuid,
        ${reservedMicros}::bigint,
        ${userDailyLimit}::bigint,
        ${globalHourlyLimit}::bigint
      )
    `);
  }

  beforeAll(async () => {
    await sql`drop schema if exists drizzle cascade`;
    await sql`drop table if exists public.thread_summaries cascade`;
    await sql`drop function if exists public.save_thread_summary(uuid, text, text, text, text, text, text, integer) cascade`;
    await sql`drop function if exists public.guard_thread_summary_update() cascade`;
    await sql`drop table if exists public.ai_spend_reservations cascade`;
    await sql`drop table if exists public.ai_spend_user_daily cascade`;
    await sql`drop table if exists public.ai_spend_global_hourly cascade`;
    await sql`drop function if exists public.reconcile_stale_ai_usage(integer) cascade`;
    await sql`drop function if exists public.reserve_ai_spend(uuid, bigint, bigint, bigint) cascade`;
    await sql`drop function if exists public.finalize_ai_spend(uuid, bigint) cascade`;
    await sql`drop function if exists public.release_ai_spend(uuid) cascade`;
    await sql`drop table if exists public.weekly_usage_reservations cascade`;
    await sql`drop table if exists public.weekly_ai_usage cascade`;
    await sql`drop type if exists public.weekly_usage_mode cascade`;
    await sql`drop function if exists public.insert_action_run(uuid, text, text, text, text, uuid, uuid, jsonb) cascade`;
    await sql`drop function if exists public.complete_action_run(uuid, text, text, jsonb) cascade`;
    await sql`drop function if exists public.insert_action_run(uuid, uuid, text, text, text, text, uuid, uuid, jsonb) cascade`;
    await sql`drop function if exists public.complete_action_run(uuid, uuid, text, text, jsonb) cascade`;
    await sql`drop table if exists public.action_runs cascade`;
    await sql`drop table if exists public.message_research cascade`;
    await sql`drop table if exists public.message_sources cascade`;
    await sql`drop type if exists public.citation_source_kind cascade`;
    await sql`drop table if exists public.message_attachments cascade`;
    await sql`drop table if exists public.workbench_documents cascade`;
    // Chunks reference room_files; drop them first so a re-migrate after incomplete cleanup cannot hit 42P07.
    await sql`drop table if exists public.room_file_chunks cascade`;
    await sql`drop table if exists public.room_files cascade`;
    await sql`drop function if exists public.set_room_files_updated_at() cascade`;
    await sql`drop function if exists public.search_room_file_chunks cascade`;
    await sql`drop function if exists public.search_room_file_chunks_semantic cascade`;
    await sql`drop table if exists public.pins cascade`;
    await sql`drop function if exists public.set_pins_updated_at() cascade`;
    await sql`drop table if exists public.room_briefs cascade`;
    await sql`drop table if exists public.rooms cascade`;
    await sql`drop function if exists public.set_rooms_updated_at() cascade`;
    await sql`drop table if exists public.memories cascade`;
    await sql`drop function if exists public.set_memories_updated_at() cascade`;
    await sql`drop function if exists public.search_memories_lexical(text, integer) cascade`;
    await sql`drop function if exists public.search_memories_semantic cascade`;
    await sql`drop type if exists public.memory_type cascade`;
    await sql`drop table if exists public.user_preferences cascade`;
    await sql`drop function if exists public.set_user_preferences_updated_at() cascade`;
    await sql`drop table if exists public.messages cascade`;
    await sql`drop table if exists public.conversations cascade`;
    await sql`drop table if exists public.users cascade`;
    await sql`drop type if exists public.response_style cascade`;
    await sql`drop type if exists public.response_length cascade`;
    await sql`drop type if exists public.preference_model cascade`;
    await sql`drop type if exists public.preferred_language cascade`;
    await sql`drop type if exists public.message_status cascade`;
    await sql`drop type if exists public.message_role cascade`;
    await sql`drop schema if exists auth cascade`;
    await sql`create schema auth`;
    await sql`create table auth.users (id uuid primary key)`;
    await sql`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$`;
    await sql`do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$`;
    await sql`do $$ begin create role anon nologin; exception when duplicate_object then null; end $$`;
    await sql`do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$`;
    await sql`grant usage on schema auth to authenticated`;
    await sql`grant usage on schema public to service_role`;
    await sql`insert into auth.users (id) values (${userA})`;
    await sql`create or replace function auth.role() returns text language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
      )
    $$`;

    // Exercise a preinstalled Supabase-style extension without relocating it.
    await sql`create schema if not exists extensions`;
    await sql`create extension if not exists vector with schema extensions`;
    await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

    await sql`insert into auth.users (id) values (${userB})`;
    await sql`insert into public.conversations (id, user_id, title) values (${conversationA}, ${userA}, 'A conversation'), (${conversationB}, ${userB}, 'B conversation')`;
    await sql`insert into public.messages (id, conversation_id, user_id, role, content, position) values (${messageB}, ${conversationB}, ${userB}, 'user', 'private message', 1)`;
  });

  it("charges Fast, Balanced, and High atomically and treats the same generation idempotently", async () => {
    const owner = await createUsageUser();
    const fastId = await createGeneration(owner);
    const balancedId = await createGeneration(owner);
    const highId = await createGeneration(owner);
    const [fast] = await reserveUsage(owner, fastId, "Fast");
    const [balanced] = await reserveUsage(owner, balancedId, "Balanced");
    const [replay] = await reserveUsage(owner, balancedId, "Balanced");
    const [high] = await reserveUsage(owner, highId, "High");
    expect([fast.credits_charged, balanced.credits_charged, replay.credits_charged, high.credits_charged]).toEqual([1, 3, 3, 6]);
    expect(replay.credits_used).toBe(4);
    const rows = await asUser(owner, (tx) => tx`select credits_used, fast_requests, balanced_requests, high_requests from public.weekly_ai_usage`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ credits_used: 10, fast_requests: 1, balanced_requests: 1, high_requests: 1 });
  });

  it("meters Deep Research above a single mode credit", async () => {
    const owner = await createUsageUser();
    const generation = await createGeneration(owner);
    const [reserved] = await reserveUsage(owner, generation, "Balanced", "research");
    expect(reserved).toMatchObject({ accepted: true, credits_charged: 9, credits_used: 9, credits_remaining: 491 });
    const [usage] = await asUser(owner, (tx) => tx`select credits_used, balanced_requests from public.weekly_ai_usage`);
    expect(usage).toEqual({ credits_used: 9, balanced_requests: 1 });
  });

  it("keeps AI spend RPCs service-role only and rejects authenticated forge", async () => {
    const owner = await createUsageUser();
    const generation = await createGeneration(owner);

    expect(await sql`
      select
        has_function_privilege('authenticated', 'public.reserve_ai_spend(uuid, uuid, bigint, bigint, bigint)', 'execute') as reserve_exec,
        has_function_privilege('authenticated', 'public.finalize_ai_spend(uuid, uuid, bigint)', 'execute') as finalize_exec,
        has_function_privilege('authenticated', 'public.release_ai_spend(uuid, uuid)', 'execute') as release_exec
    `).toEqual([{ reserve_exec: false, finalize_exec: false, release_exec: false }]);
    expect(await sql`
      select
        has_function_privilege('service_role', 'public.reserve_ai_spend(uuid, uuid, bigint, bigint, bigint)', 'execute') as reserve_exec,
        has_function_privilege('service_role', 'public.finalize_ai_spend(uuid, uuid, bigint)', 'execute') as finalize_exec,
        has_function_privilege('service_role', 'public.release_ai_spend(uuid, uuid)', 'execute') as release_exec
    `).toEqual([{ reserve_exec: true, finalize_exec: true, release_exec: true }]);

    await expect(asUser(owner, (tx) => tx`
      select * from public.reserve_ai_spend(
        ${owner}::uuid, ${generation}::uuid, 100000::bigint, 1000000::bigint, 1000000::bigint
      )
    `)).rejects.toThrow(/permission denied/i);
    await expect(asUser(owner, (tx) => tx`
      select public.finalize_ai_spend(${owner}::uuid, ${generation}::uuid, 1::bigint) as ok
    `)).rejects.toThrow(/permission denied/i);
    await expect(asUser(owner, (tx) => tx`
      select public.release_ai_spend(${owner}::uuid, ${generation}::uuid) as ok
    `)).rejects.toThrow(/permission denied/i);
  });

  it("enforces dollar spend ceilings independently of weekly credits and reconciles stale holds", async () => {
    const owner = await createUsageUser();
    const okGeneration = await createGeneration(owner);
    const blockedGeneration = await createGeneration(owner);
    const staleGeneration = await createGeneration(owner);

    const [accepted] = await reserveSpend(owner, okGeneration, 100_000, 150_000, 1_000_000);
    expect(accepted).toMatchObject({ accepted: true });
    // postgres.js returns bigint columns as strings
    expect(Number(accepted.reserved_micros)).toBe(100_000);

    const [rejected] = await reserveSpend(owner, blockedGeneration, 100_000, 150_000, 1_000_000);
    expect(rejected).toMatchObject({ accepted: false });
    expect(Number(rejected.reserved_micros)).toBe(0);

    await reserveSpend(owner, staleGeneration, 40_000, 1_000_000, 1_000_000);
    await sql`update public.messages set status = 'error' where id = ${staleGeneration}`;
    await sql`update public.ai_spend_reservations set created_at = now() - interval '20 minutes' where generation_id = ${staleGeneration}`;
    await sql`update public.weekly_usage_reservations set created_at = now() - interval '20 minutes' where generation_id = ${staleGeneration}`;

    // Also leave an unstarted weekly credit hold on the stale generation so reconcile can refund it.
    // Spend already reserved above; weekly reserve separately.
    const weeklyGen = await createGeneration(owner);
    await reserveUsage(owner, weeklyGen, "Fast");
    await sql`update public.messages set status = 'error' where id = ${weeklyGen}`;
    await sql`update public.weekly_usage_reservations set created_at = now() - interval '20 minutes' where generation_id = ${weeklyGen}`;

    await asServiceRole(async (tx) => {
      const rows = await tx`select * from public.reconcile_stale_ai_usage(600)`;
      expect(rows[0]).toMatchObject({ weekly_released: 1, spend_released: 1 });
    });

    await expect(asUser(owner, (tx) => tx`select * from public.reconcile_stale_ai_usage(600)`)).rejects.toThrow();
  });

  it("rejects a concurrent race at exactly 500 credits without resetting counters", async () => {
    const owner = await createUsageUser();
    const utcMonday = new Date();
    utcMonday.setUTCHours(0, 0, 0, 0);
    utcMonday.setUTCDate(utcMonday.getUTCDate() - ((utcMonday.getUTCDay() + 6) % 7));
    const weekStart = utcMonday.toISOString().slice(0, 10);
    // Seed near the new ceiling so the race stays small but still proves the hard cap and concurrency safety.
    await sql`insert into public.weekly_ai_usage (user_id, week_start, credits_used, fast_requests) values (${owner}, ${weekStart}::date, 495, 495)`;
    const generationIds = await Promise.all(Array.from({ length: 10 }, () => createGeneration(owner)));
    const results = await Promise.all(generationIds.map((id) => reserveUsage(owner, id, "Fast")));
    const reservations = results.map(([row]) => row);
    expect(reservations.filter((row) => row.accepted)).toHaveLength(5);
    expect(reservations.filter((row) => !row.accepted)).toHaveLength(5);
    const [usage] = await asUser(owner, (tx) => tx`select credits_used, fast_requests from public.weekly_ai_usage`);
    expect(usage).toEqual({ credits_used: 500, fast_requests: 500 });
  }, 30_000);

  it("gives accounts already at 100 credits 400 remaining under the raised ceiling", async () => {
    const owner = await createUsageUser();
    const utcMonday = new Date();
    utcMonday.setUTCHours(0, 0, 0, 0);
    utcMonday.setUTCDate(utcMonday.getUTCDate() - ((utcMonday.getUTCDay() + 6) % 7));
    const weekStart = utcMonday.toISOString().slice(0, 10);
    await sql`insert into public.weekly_ai_usage (user_id, week_start, credits_used, fast_requests) values (${owner}, ${weekStart}::date, 100, 100)`;
    const [usage] = await asUser(owner, (tx) => tx`select * from public.get_current_weekly_ai_usage()`);
    expect(usage).toMatchObject({ credits_used: 100, credits_remaining: 400 });
    const generation = await createGeneration(owner);
    const [reserved] = await reserveUsage(owner, generation, "Fast");
    expect(reserved).toMatchObject({ accepted: true, credits_charged: 1, credits_used: 101, credits_remaining: 399 });
  });

  it("isolates usage by owner and denies direct client writes", async () => {
    const ownerA = await createUsageUser();
    const ownerB = await createUsageUser();
    const generation = await createGeneration(ownerA);
    await reserveUsage(ownerA, generation, "High");
    const visibleA = await asUser(ownerA, (tx) => tx`select credits_used from public.weekly_ai_usage`);
    const visibleB = await asUser(ownerB, (tx) => tx`select credits_used from public.weekly_ai_usage`);
    expect(visibleA).toEqual([{ credits_used: 6 }]);
    expect(visibleB).toEqual([]);
    await expect(asUser(ownerA, (tx) => tx`update public.weekly_ai_usage set credits_used = 0`)).rejects.toThrow(/permission denied/i);
    await expect(asUser(ownerA, (tx) => tx`select * from public.weekly_usage_reservations`)).rejects.toThrow(/permission denied/i);
    await expect(reserveUsage(ownerB, generation, "Fast")).rejects.toThrow();
  });

  it("starts a fresh allowance in the new UTC week and returns the server reset timestamp", async () => {
    const owner = await createUsageUser();
    const utcMonday = new Date();
    utcMonday.setUTCHours(0, 0, 0, 0);
    utcMonday.setUTCDate(utcMonday.getUTCDate() - ((utcMonday.getUTCDay() + 6) % 7));
    const previousWeek = new Date(utcMonday);
    previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
    const previousWeekStart = previousWeek.toISOString().slice(0, 10);
    await sql`insert into public.weekly_ai_usage (user_id, week_start, credits_used, fast_requests) values (${owner}, ${previousWeekStart}::date, 100, 100)`;
    const generation = await createGeneration(owner);
    const [usage] = await asUser(owner, (tx) => tx`select * from public.get_current_weekly_ai_usage()`);
    expect(usage.credits_used).toBe(0);
    expect(Date.parse(usage.reset_at as string)).toBeGreaterThan(Date.now());
    const [reserved] = await reserveUsage(owner, generation, "Fast");
    expect(reserved).toMatchObject({ accepted: true, credits_charged: 1, credits_used: 1, credits_remaining: 499 });
  });

  it("makes pre-stream reservation release atomic and idempotent without negative usage", async () => {
    const owner = await createUsageUser();
    const generation = await createGeneration(owner);
    await reserveUsage(owner, generation, "Balanced");
    const release = () => asUser(owner, (tx) => tx`select public.release_weekly_ai_usage(${generation}::uuid) AS released`);
    await expect(release()).resolves.toEqual([{ released: true }]);
    await expect(release()).resolves.toEqual([{ released: false }]);
    const [usage] = await asUser(owner, (tx) => tx`select credits_used, balanced_requests from public.weekly_ai_usage`);
    expect(usage).toEqual({ credits_used: 0, balanced_requests: 0 });
    await expect(sql`update public.weekly_ai_usage set credits_used = -1 where user_id = ${owner}`).rejects.toThrow();
  });

  it("rejects re-reserve after release for the same generation, but allows a held reservation to be re-read", async () => {
    const owner = await createUsageUser();
    const generation = await createGeneration(owner);
    const [first] = await reserveUsage(owner, generation, "Fast");
    expect(first).toMatchObject({ accepted: true, credits_charged: 1, credits_used: 1 });
    // Held reservation: a second reserve for the same generation must stay accepted (idempotent read).
    const [held] = await reserveUsage(owner, generation, "Fast");
    expect(held).toMatchObject({ accepted: true, credits_charged: 1, credits_used: 1 });
    await expect(asUser(owner, (tx) => tx`select public.release_weekly_ai_usage(${generation}::uuid) AS released`)).resolves.toEqual([
      { released: true },
    ]);
    // After release, reserve_weekly_ai_usage must not accept again for this generation id.
    const [again] = await reserveUsage(owner, generation, "Fast");
    expect(again).toMatchObject({ accepted: false, credits_charged: 0 });
    const [usage] = await asUser(owner, (tx) => tx`select credits_used, fast_requests from public.weekly_ai_usage`);
    expect(usage).toEqual({ credits_used: 0, fast_requests: 0 });
  });

  it("refuses to refund a reservation after provider execution starts", async () => {
    const owner = await createUsageUser();
    const generation = await createGeneration(owner);
    await reserveUsage(owner, generation, "High");
    await expect(startUsage(owner, generation)).resolves.toEqual([{ started: true }]);
    await expect(startUsage(owner, generation)).resolves.toEqual([{ started: true }]);
    await expect(asUser(owner, (tx) => tx`select public.release_weekly_ai_usage(${generation}::uuid) AS released`)).resolves.toEqual([{ released: false }]);
    const [usage] = await asUser(owner, (tx) => tx`select credits_used, high_requests from public.weekly_ai_usage`);
    expect(usage).toEqual({ credits_used: 6, high_requests: 1 });
  });

  it("serializes a concurrent start and refund so only one transition succeeds", async () => {
    const owner = await createUsageUser();
    const generation = await createGeneration(owner);
    await reserveUsage(owner, generation, "Balanced");
    const [started, released] = await Promise.all([
      startUsage(owner, generation),
      asUser(owner, (tx) => tx`select public.release_weekly_ai_usage(${generation}::uuid) AS released`),
    ]);
    if (started[0].started) {
      expect(released).toEqual([{ released: false }]);
      const [usage] = await asUser(owner, (tx) => tx`select credits_used, balanced_requests from public.weekly_ai_usage`);
      expect(usage).toEqual({ credits_used: 3, balanced_requests: 1 });
    } else {
      expect(released).toEqual([{ released: true }]);
      const [usage] = await asUser(owner, (tx) => tx`select credits_used, balanced_requests from public.weekly_ai_usage`);
      expect(usage).toEqual({ credits_used: 0, balanced_requests: 0 });
    }
  });

  afterAll(async () => {
    await sql.end();
  });

  it("backfills existing auth users and creates app rows for new sign-ups", async () => {
    const rows = await sql`select id from public.users where id in (${userA}, ${userB})`;
    expect(rows).toHaveLength(2);
  });

  it("allows each user to read only their conversations", async () => {
    const rows = await asUser(userA, (tx) => tx`select id from public.conversations`);
    expect(rows.map((row) => row.id)).toEqual([conversationA]);
  });

  it("rejects creating a conversation for another user", async () => {
    await expect(
      asUser(userA, (tx) =>
        tx`insert into public.conversations (user_id, title) values (${userB}, 'not owned')`,
      ),
    ).rejects.toThrow();
  });

  it("prevents updating or deleting another user's conversation", async () => {
    const { updated, deleted } = await asUser(userA, async (tx) => ({
      updated: await tx`update public.conversations set title = 'hijacked' where id = ${conversationB} returning id`,
      deleted: await tx`delete from public.conversations where id = ${conversationB} returning id`,
    }));
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);

    const [ownerRow] = await sql`select title from public.conversations where id = ${conversationB}`;
    expect(ownerRow.title).toBe("B conversation");
  });

  it("prevents cross-user message reads and writes", async () => {
    const rows = await asUser(userA, (tx) =>
      tx`select id from public.messages where conversation_id = ${conversationB}`,
    );
    expect(rows).toHaveLength(0);

    await expect(
      asUser(userA, (tx) =>
        tx`insert into public.messages (conversation_id, user_id, role, content, position) values (${conversationB}, ${userB}, 'user', 'not owned', 2)`,
      ),
    ).rejects.toThrow();

    const { updated, deleted } = await asUser(userA, async (tx) => ({
      updated: await tx`update public.messages set content = 'hijacked' where id = ${messageB} returning id`,
      deleted: await tx`delete from public.messages where id = ${messageB} returning id`,
    }));
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    const [ownerRow] = await sql`select content from public.messages where id = ${messageB}`;
    expect(ownerRow.content).toBe("private message");
  });

  it("keeps rooms owner-scoped and leaves general threads valid when a room is deleted", async () => {
    const roomA = randomUUID();
    const roomB = randomUUID();
    const thread = randomUUID();
    await asUser(userA, (tx) => tx`insert into public.rooms (id, user_id, name, instructions) values (${roomA}, ${userA}, 'Nibie', 'Stay calm')`);
    await sql`insert into public.rooms (id, user_id, name) values (${roomB}, ${userB}, 'Private room')`;
    const visible = await asUser(userA, (tx) => tx`select id from public.rooms`);
    expect(visible.map((row) => row.id)).toEqual([roomA]);
    await expect(asUser(userA, (tx) => tx`insert into public.rooms (user_id, name) values (${userB}, 'not owned')`)).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`insert into public.conversations (user_id, room_id, title) values (${userA}, ${roomB}, 'cross room')`)).rejects.toThrow();
    await asUser(userA, (tx) => tx`insert into public.conversations (id, user_id, room_id, title) values (${thread}, ${userA}, ${roomA}, 'In the room')`);
    await asUser(userA, (tx) => tx`insert into public.room_briefs (room_id, user_id, goal) values (${roomA}, ${userA}, 'Ship it')`);
    const brief = await asUser(userB, (tx) => tx`select goal from public.room_briefs where room_id = ${roomA}`);
    expect(brief).toHaveLength(0);
    await asUser(userA, (tx) => tx`delete from public.rooms where id = ${roomA}`);
    const [kept] = await asUser(userA, (tx) => tx`select room_id, title from public.conversations where id = ${thread}`);
    expect(kept).toEqual({ room_id: null, title: "In the room" });
  });

  it("keeps workbench documents owner-scoped, allows a null room, and detaches them when a room is deleted", async () => {
    const roomA = randomUUID();
    const roomB = randomUUID();
    const docGeneral = randomUUID();
    const docRoom = randomUUID();
    const docB = randomUUID();
    const docEmpty = randomUUID();

    await asUser(userA, (tx) => tx`insert into public.workbench_documents (id, user_id, title, content) values (${docGeneral}, ${userA}, 'Notes', 'hello')`);
    await asUser(userA, (tx) => tx`insert into public.workbench_documents (id, user_id, title, content) values (${docEmpty}, ${userA}, 'Blank', '')`);
    const [general] = await asUser(userA, (tx) => tx`select room_id, title, content from public.workbench_documents where id = ${docGeneral}`);
    expect(general).toEqual({ room_id: null, title: "Notes", content: "hello" });
    const [blank] = await asUser(userA, (tx) => tx`select content from public.workbench_documents where id = ${docEmpty}`);
    expect(blank).toEqual({ content: "" });

    await asUser(userA, (tx) => tx`insert into public.rooms (id, user_id, name) values (${roomA}, ${userA}, 'Studio')`);
    await sql`insert into public.rooms (id, user_id, name) values (${roomB}, ${userB}, 'Private studio')`;
    await asUser(userA, (tx) => tx`insert into public.workbench_documents (id, user_id, room_id, title, content) values (${docRoom}, ${userA}, ${roomA}, 'In room', 'body')`);
    await expect(asUser(userA, (tx) => tx`insert into public.workbench_documents (user_id, room_id, title, content) values (${userA}, ${roomB}, 'Cross', 'no')`)).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`update public.workbench_documents set room_id = ${roomB} where id = ${docRoom}`)).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`insert into public.workbench_documents (user_id, title, content) values (${userB}, 'Stolen', 'no')`)).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`update public.workbench_documents set user_id = ${userB} where id = ${docGeneral}`)).rejects.toThrow();

    await sql`insert into public.workbench_documents (id, user_id, title, content) values (${docB}, ${userB}, 'Secret', 'private body')`;
    const hidden = await asUser(userA, (tx) => tx`select id from public.workbench_documents where id = ${docB}`);
    expect(hidden).toHaveLength(0);
    const { updated, deleted } = await asUser(userA, async (tx) => ({
      updated: await tx`update public.workbench_documents set title = 'hijacked', content = 'hijacked' where id = ${docB} returning id`,
      deleted: await tx`delete from public.workbench_documents where id = ${docB} returning id`,
    }));
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    const [ownerDoc] = await sql`select title, content from public.workbench_documents where id = ${docB}`;
    expect(ownerDoc).toEqual({ title: "Secret", content: "private body" });

    await asUser(userA, (tx) => tx`update public.workbench_documents set title = 'Renamed', content = 'edited' where id = ${docGeneral}`);
    const [edited] = await asUser(userA, (tx) => tx`select title, content from public.workbench_documents where id = ${docGeneral}`);
    expect(edited).toEqual({ title: "Renamed", content: "edited" });

    await asUser(userA, (tx) => tx`delete from public.rooms where id = ${roomA}`);
    const [detached] = await asUser(userA, (tx) => tx`select room_id, title, content from public.workbench_documents where id = ${docRoom}`);
    expect(detached).toEqual({ room_id: null, title: "In room", content: "body" });

    await asUser(userA, (tx) => tx`delete from public.workbench_documents where id = ${docGeneral}`);
    const gone = await asUser(userA, (tx) => tx`select id from public.workbench_documents where id = ${docGeneral}`);
    expect(gone).toHaveLength(0);
  });

  it("scopes vector search and missing-only backfill to owner and Room", async () => {
    const room = randomUUID(), otherRoom = randomUUID(), foreignRoom = randomUUID();
    const file = randomUUID(), otherFile = randomUUID(), foreignFile = randomUUID();
    const chunk = randomUUID(), foreignChunk = randomUUID();
    const doc = "The deployment pipeline releases the backend service after validation.";
    for (const [roomId, owner, fileId] of [[room, userA, file], [otherRoom, userA, otherFile], [foreignRoom, userB, foreignFile]]) {
      await sql`insert into public.rooms (id, user_id, name) values (${roomId}, ${owner}, 'Vector room')`;
      await sql`insert into public.room_files (id, user_id, room_id, original_name, mime_type, size_bytes, storage_path, extracted_text)
        values (${fileId}, ${owner}, ${roomId}, 'deploy.txt', 'text/plain', 80, ${`${owner}/${roomId}/${fileId}/${fileId}.txt`}, ${doc})`;
    }
    await asUser(userA, tx => tx`insert into public.room_file_chunks (id, file_id, user_id, room_id, chunk_index, content) values (${chunk}, ${file}, ${userA}, ${room}, 0, ${doc})`);
    await sql`insert into public.room_file_chunks (id, file_id, user_id, room_id, chunk_index, content) values (${foreignChunk}, ${foreignFile}, ${userB}, ${foreignRoom}, 0, ${doc})`;
    const rows = JSON.stringify([{ id: chunk, embedding: vector(0) }, { id: foreignChunk, embedding: vector(0) }]);
    expect(await asUser(userA, tx => tx`select * from public.missing_room_file_embeddings(${foreignRoom}, 100)`)).toEqual([]);
    expect(await asUser(userA, tx => tx`select public.fill_room_file_embeddings(${otherRoom}, ${rows}::jsonb) as n`)).toEqual([{ n: 0 }]);
    expect(await asUser(userA, tx => tx`select public.fill_room_file_embeddings(${room}, ${rows}::jsonb) as n`)).toEqual([{ n: 1 }]);
    expect(await asUser(userA, tx => tx`select public.fill_room_file_embeddings(${room}, ${rows}::jsonb) as n`)).toEqual([{ n: 0 }]);
    expect(await asUser(userA, tx => tx`select * from public.missing_room_file_embeddings(${room}, 20)`)).toEqual([]);
    const embedding = JSON.stringify(vector(0));
    await sql`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content, embedding) values (${otherFile}, ${userA}, ${otherRoom}, 0, ${doc}, ${embedding})`;
    const semantic = await asUser(userA, tx => tx`select * from public.search_room_file_chunks_semantic(${room}, ${embedding}, 100)`);
    expect(semantic.map(c => c.file_id)).toEqual([file]);
    expect(semantic[0].similarity).toBeCloseTo(1);
    expect(await asUser(userB, tx => tx`select * from public.search_room_file_chunks_semantic(${room}, ${embedding}, 10)`)).toEqual([]);
    expect(await asUser(userA, tx => tx`select * from public.search_room_file_chunks_semantic(${foreignRoom}, ${embedding}, 10)`)).toEqual([]);
    const lexical = await asUser(userA, tx => tx`select * from public.search_room_file_chunks(${room}, 'backend OR shipped OR production', 10)`);
    expect(fuseRoomFileCandidates("How is the backend shipped to production?", lexical as unknown as Candidate[], semantic as unknown as Candidate[])[0].file_id).toBe(file);
    await asUser(userA, tx => tx`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content, embedding)
      select ${file}, ${userA}, ${room}, n, ${doc}, ${embedding} from generate_series(1, 12) n`);
    expect((await asUser(userA, tx => tx`select * from public.search_room_file_chunks_semantic(${room}, ${embedding}, 100)`)).length).toBe(10);
    expect((await asUser(userA, tx => tx`select * from public.search_room_file_chunks(${room}, 'backend', 100)`)).length).toBe(10);
    await expect(asUser(userA, tx => tx`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content, embedding)
      values (${file}, ${userA}, ${room}, 20, ${doc}, ${JSON.stringify(Array(512).fill(0))})`)).rejects.toThrow(/room_file_chunks_embedding_nonzero/);
    await expect(asUser(userA, tx => tx`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content, embedding)
      values (${file}, ${userA}, ${room}, 20, ${doc}, '[1,2]')`)).rejects.toThrow(/512 dimensions/);
    await expect(asUser(userA, tx => tx`update public.room_file_chunks set content = 'tampered' where id = ${chunk}`)).rejects.toThrow(/permission denied/);
    expect(await asUser(userA, tx => tx`update public.room_file_chunks set embedding = ${JSON.stringify(vector(1))} where id = ${chunk} returning id`)).toEqual([]);
    await expect(asUser(userA, tx => tx`select public.fill_room_file_embeddings(${room}, ${JSON.stringify(Array(21).fill({ id: chunk, embedding: vector(0) }))}::jsonb)`)).rejects.toThrow(/Invalid embedding batch/);
    const indexes = await sql`select indexdef from pg_indexes where indexname = 'room_file_chunks_embedding_hnsw_idx'`;
    expect(indexes[0].indexdef).toContain('USING hnsw');
    await asUser(userA, tx => tx`delete from public.room_files where id = ${file}`);
    expect(await sql`select id from public.room_file_chunks where id = ${chunk}`).toEqual([]);
    await sql`delete from public.rooms where id in (${room}, ${otherRoom}, ${foreignRoom})`;
  });

  it("keeps room files owner-scoped, including extracted text", async () => {
    const roomA = randomUUID();
    const roomB = randomUUID();
    const roomOther = randomUUID();
    const fileB = randomUUID();
    const pathB = `${userB}/${roomB}/${fileB}/${fileB}.txt`;
    const fileA = randomUUID();
    const pathA = `${userA}/${roomA}/${fileA}/${fileA}.txt`;
    const fileOther = randomUUID();
    const pathOther = `${userA}/${roomOther}/${fileOther}/${fileOther}.txt`;
    const crossId = randomUUID();
    const crossPath = `${userA}/${roomB}/${crossId}/${crossId}.txt`;
    await asUser(userA, (tx) => tx`insert into public.rooms (id, user_id, name) values (${roomA}, ${userA}, 'Files')`);
    await asUser(userA, (tx) => tx`insert into public.rooms (id, user_id, name) values (${roomOther}, ${userA}, 'Other files')`);
    await sql`insert into public.rooms (id, user_id, name) values (${roomB}, ${userB}, 'Private files')`;
    await sql`insert into public.room_files (id, user_id, room_id, original_name, mime_type, size_bytes, storage_path, extracted_text) values (${fileB}, ${userB}, ${roomB}, 'secret.txt', 'text/plain', 12, ${pathB}, 'user b private note')`;
    await asUser(userA, (tx) => tx`insert into public.room_files (id, user_id, room_id, original_name, mime_type, size_bytes, storage_path, extracted_text) values (${fileA}, ${userA}, ${roomA}, 'notes.txt', 'text/plain', 5, ${pathA}, 'hello from a')`);
    await asUser(userA, (tx) => tx`insert into public.room_files (id, user_id, room_id, original_name, mime_type, size_bytes, storage_path, extracted_text) values (${fileOther}, ${userA}, ${roomOther}, 'other.txt', 'text/plain', 5, ${pathOther}, 'cobalt kestrel other room')`);
    await asUser(userA, (tx) => tx`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content) values (${fileA}, ${userA}, ${roomA}, 0, 'deployment uses the cobalt kestrel cluster')`);
    await asUser(userA, (tx) => tx`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content) values (${fileA}, ${userA}, ${roomA}, 1, 'cobalt kestrel cobalt kestrel deployment cluster details')`);
    await asUser(userA, (tx) => tx`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content) values (${fileA}, ${userA}, ${roomA}, 2, 'auth middleware validates bearer tokens')`);
    await asUser(userA, (tx) => tx`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content) values (${fileA}, ${userA}, ${roomA}, 3, 'GIN index supports lexical query ranking')`);
    await asUser(userA, (tx) => tx`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content) values (${fileA}, ${userA}, ${roomA}, 4, 'deploy pipeline releases backend service')`);
    await sql`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content) values (${fileB}, ${userB}, ${roomB}, 0, 'private cobalt kestrel credentials')`;
    await asUser(userA, (tx) => tx`insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content) values (${fileOther}, ${userA}, ${roomOther}, 0, 'cobalt kestrel belongs to a different room')`);
    const ranked = await asUser(userA, (tx) => tx`select file_id, original_name, chunk_index from public.search_room_file_chunks(${roomA}::uuid, 'cobalt kestrel', 5)`);
    expect(ranked.map((row) => row.chunk_index)).toEqual([1, 0]);
    const authRanked = await asUser(userA, (tx) => tx`select chunk_index from public.search_room_file_chunks(${roomA}::uuid, 'auth bearer', 5)`);
    const indexRanked = await asUser(userA, (tx) => tx`select chunk_index from public.search_room_file_chunks(${roomA}::uuid, 'index lexical', 5)`);
    const deployRanked = await asUser(userA, (tx) => tx`select chunk_index from public.search_room_file_chunks(${roomA}::uuid, 'deploy pipeline', 5)`);
    expect(authRanked[0]?.chunk_index).toBe(2);
    expect(indexRanked[0]?.chunk_index).toBe(3);
    expect(deployRanked[0]?.chunk_index).toBe(4);
    const natural = await asUser(userA, (tx) => tx`select chunk_index, content from public.search_room_file_chunks(${roomA}::uuid, 'What does our deployment pipeline do?', 5)`);
    expect(natural.map((row) => row.chunk_index)).toEqual(expect.arrayContaining([0, 1, 4]));
    expect(natural.every((row) => /deployment|pipeline|deploy/i.test(String(row.content)))).toBe(true);
    const crossRoom = await asUser(userA, (tx) => tx`select file_id from public.search_room_file_chunks(${roomB}::uuid, 'cobalt kestrel', 5)`);
    expect(crossRoom).toEqual([]);
    const hiddenSameOwnerRoom = await asUser(userA, (tx) => tx`select file_id from public.search_room_file_chunks(${roomA}::uuid, 'cobalt kestrel', 5)`);
    expect(hiddenSameOwnerRoom.map((row) => row.file_id)).not.toContain(fileOther);
    const visibleChunks = await asUser(userA, (tx) => tx`select file_id from public.room_file_chunks`);
    expect(visibleChunks.map((row) => row.file_id).sort()).toEqual([fileA, fileA, fileA, fileA, fileA, fileOther].sort());
    const visible = await asUser(userA, (tx) => tx`select id, extracted_text from public.room_files`);
    expect(visible.map((row) => row.id).sort()).toEqual([fileA, fileOther].sort());
    const legacyFile = randomUUID();
    const legacyPath = `${userA}/${roomA}/${legacyFile}/${legacyFile}.txt`;
    await asUser(userA, (tx) => tx`insert into public.room_files (id, user_id, room_id, original_name, mime_type, size_bytes, storage_path, extracted_text) values (${legacyFile}, ${userA}, ${roomA}, 'legacy.txt', 'text/plain', 40, ${legacyPath}, 'legacy deployment pipeline notes for ops')`);
    expect(await asUser(userA, (tx) => tx`select id from public.room_file_chunks where file_id = ${legacyFile}`)).toEqual([]);
    // Migration-time backfill runs as the migrator (not authenticated); mirror that here.
    await sql`
      insert into public.room_file_chunks (file_id, user_id, room_id, chunk_index, content)
      select f.id, f.user_id, f.room_id, c.chunk_index, c.content
      from public.room_files f
      cross join lateral public.chunk_room_file_text(f.extracted_text) as c
      where f.id = ${legacyFile}
        and coalesce(btrim(f.extracted_text), '') <> ''
        and not exists (select 1 from public.room_file_chunks existing where existing.file_id = f.id)
      on conflict (file_id, chunk_index) do nothing
    `;
    const backfilled = await asUser(userA, (tx) => tx`select chunk_index, content from public.room_file_chunks where file_id = ${legacyFile}`);
    expect(backfilled).toHaveLength(1);
    expect(backfilled[0]?.content).toContain("legacy deployment pipeline");
    const legacyHits = await asUser(userA, (tx) => tx`select file_id from public.search_room_file_chunks(${roomA}::uuid, 'What does our deployment pipeline do?', 5)`);
    expect(legacyHits.map((row) => row.file_id)).toContain(legacyFile);
    await expect(asUser(userA, (tx) => tx`insert into public.room_files (user_id, room_id, original_name, mime_type, size_bytes, storage_path, extracted_text) values (${userB}, ${roomB}, 'stolen.txt', 'text/plain', 4, ${`${userB}/${roomB}/${randomUUID()}/x.txt`}, 'nope')`)).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`insert into public.room_files (id, user_id, room_id, original_name, mime_type, size_bytes, storage_path, extracted_text) values (${crossId}, ${userA}, ${roomB}, 'cross.txt', 'text/plain', 4, ${crossPath}, 'nope')`)).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`update public.room_files set extracted_text = 'hijacked' where id = ${fileB} returning id`)).rejects.toThrow();
    const deleted = await asUser(userA, (tx) => tx`delete from public.room_files where id = ${fileB} returning id`);
    expect(deleted).toHaveLength(0);
    const [ownerRow] = await sql`select extracted_text from public.room_files where id = ${fileB}`;
    expect(ownerRow.extracted_text).toBe("user b private note");
    await asUser(userA, (tx) => tx`delete from public.room_files where id = ${fileA}`);
    expect(await sql`select id from public.room_file_chunks where file_id = ${fileA}`).toEqual([]);
  });

  it("keeps pins owner-scoped and deletes them with the room", async () => {
    const roomA = randomUUID();
    const roomB = randomUUID();
    const pinA = randomUUID();
    const pinB = randomUUID();
    await asUser(userA, (tx) => tx`insert into public.rooms (id, user_id, name) values (${roomA}, ${userA}, 'Nibie')`);
    await sql`insert into public.rooms (id, user_id, name) values (${roomB}, ${userB}, 'Private room')`;
    await asUser(userA, (tx) => tx`insert into public.pins (id, user_id, room_id, title, content) values (${pinA}, ${userA}, ${roomA}, 'Deployment rule', 'Seoul')`);
    await sql`insert into public.pins (id, user_id, room_id, title, content) values (${pinB}, ${userB}, ${roomB}, 'Secret', 'Do not read')`;
    const visible = await asUser(userA, (tx) => tx`select id, title from public.pins`);
    expect(visible).toEqual([{ id: pinA, title: "Deployment rule" }]);
    await expect(asUser(userA, (tx) => tx`insert into public.pins (user_id, room_id, title, content) values (${userB}, ${roomB}, 'Stolen', 'No')`)).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`insert into public.pins (user_id, room_id, title, content) values (${userA}, ${roomB}, 'Attached', 'No')`)).rejects.toThrow();
    const hiddenUpdate = await asUser(userA, (tx) => tx`update public.pins set title = 'Hijacked' where id = ${pinB} returning id`);
    const hiddenDelete = await asUser(userA, (tx) => tx`delete from public.pins where id = ${pinB} returning id`);
    expect(hiddenUpdate).toHaveLength(0);
    expect(hiddenDelete).toHaveLength(0);
    const [stillPrivate] = await sql`select title, content from public.pins where id = ${pinB}`;
    expect(stillPrivate).toEqual({ title: "Secret", content: "Do not read" });
    await asUser(userA, (tx) => tx`delete from public.rooms where id = ${roomA}`);
    const removed = await sql`select id from public.pins where id = ${pinA}`;
    const kept = await sql`select id from public.pins where id = ${pinB}`;
    expect(removed).toHaveLength(0);
    expect(kept).toEqual([{ id: pinB }]);
  });

  it("allows users to read only their own profile row", async () => {
    const rows = await asUser(userA, (tx) => tx`select id from public.users`);
    expect(rows.map((row) => row.id)).toEqual([userA]);
  });

  it("persists a conversation, selected model, ordered user history, rename, and delete", async () => {
    const id = randomUUID();
    await asUser(userA, async (tx) => {
      await tx`insert into public.conversations (id, user_id, title, selected_model) values (${id}, ${userA}, 'New chat', 'Reasoning')`;
      await tx`insert into public.messages (conversation_id, user_id, role, content, position) values (${id}, ${userA}, 'user', 'first prompt', 1), (${id}, ${userA}, 'user', 'second prompt', 2)`;
      const conversations = await tx`select id, title, selected_model from public.conversations where id = ${id}`;
      expect(conversations).toEqual([{ id, title: "New chat", selected_model: "Reasoning" }]);
      const messages = await tx`select content, position from public.messages where conversation_id = ${id} order by position asc`;
      expect(messages).toEqual([{ content: "first prompt", position: 1 }, { content: "second prompt", position: 2 }]);
      await tx`update public.conversations set title = 'Renamed chat' where id = ${id}`;
      const renamed = await tx`select title from public.conversations where id = ${id}`;
      expect(renamed[0].title).toBe("Renamed chat");
      await tx`delete from public.conversations where id = ${id}`;
      const deleted = await tx`select id from public.conversations where id = ${id}`;
      expect(deleted).toHaveLength(0);
    });
  });

  it("keeps custom instructions owner-scoped with length CHECKs", async () => {
    const id = randomUUID();
    await asUser(userA, async (tx) => {
      await tx`insert into public.conversations (id, user_id, selected_model) values (${id}, ${userA}, 'Balanced')`;
      const [defaults] = await tx`select custom_instructions from public.conversations where id = ${id}`;
      expect(defaults).toEqual({ custom_instructions: null });
      await tx`update public.conversations set custom_instructions = 'Prefer TypeScript' where id = ${id}`;
      const [saved] = await tx`select custom_instructions from public.conversations where id = ${id}`;
      expect(saved).toEqual({ custom_instructions: "Prefer TypeScript" });
    });
    const hidden = await asUser(userB, (tx) => tx`select custom_instructions from public.conversations where id = ${id}`);
    expect(hidden).toEqual([]);
    const updated = await asUser(userB, (tx) => tx`update public.conversations set custom_instructions = 'stolen' where id = ${id} returning id`);
    expect(updated).toEqual([]);
    const [still] = await asUser(userA, (tx) => tx`select custom_instructions from public.conversations where id = ${id}`);
    expect(still).toEqual({ custom_instructions: "Prefer TypeScript" });
    await expect(asUser(userA, (tx) => tx`update public.conversations set custom_instructions = ${"x".repeat(2001)} where id = ${id}`)).rejects.toThrow();
    await asUser(userA, (tx) => tx`delete from public.conversations where id = ${id}`);
  });

  async function newConversation() {
    const id = randomUUID();
    await asUser(userA, (tx) => tx`insert into public.conversations (id, user_id, selected_model) values (${id}, ${userA}, 'Balanced')`);
    return id;
  }

  it("deduplicates concurrent user submissions and rejects a changed payload", async () => {
    const conversation = await newConversation();
    const message = randomUUID();
    const results = await Promise.all([1, 2].map(() => asUser(userA, (tx) => tx`select * from public.append_user_message(${conversation}, ${message}, 'hello')`)));
    expect(results.map((rows) => rows[0])).toEqual([{ id: message, position: 1 }, { id: message, position: 1 }]);
    const rows = await asUser(userA, (tx) => tx`select id from public.messages where conversation_id = ${conversation}`);
    expect(rows).toHaveLength(1);
    await expect(asUser(userA, (tx) => tx`select * from public.append_user_message(${conversation}, ${message}, 'changed')`)).rejects.toMatchObject({ code: "PT409" });
  });

  it("allows only one concurrent generation and rejects new messages while it runs", async () => {
    const conversation = await newConversation();
    const message = randomUUID();
    await asUser(userA, (tx) => tx`select * from public.append_user_message(${conversation}, ${message}, 'hello')`);
    const results = await Promise.allSettled([1, 2].map(() => asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason).toMatchObject({ code: "PT409" });
    const rows = await asUser(userA, (tx) => tx`select id from public.messages where conversation_id = ${conversation} and status = 'streaming'`);
    expect(rows).toHaveLength(1);
    await expect(asUser(userA, (tx) => tx`select * from public.append_user_message(${conversation}, ${randomUUID()}, 'overlap')`)).rejects.toMatchObject({ code: "PT409" });
    await expect(asUser(userA, (tx) => tx`insert into public.messages (conversation_id, user_id, role, content, status, position) values (${conversation}, ${userA}, 'assistant', 'bypass', 'streaming', 99)`)).rejects.toMatchObject({ code: "23505" });
  });

  it("replaces interrupted generation with a new UUID, fences stale writes, and replays completion", async () => {
    const conversation = await newConversation();
    const message = randomUUID();
    await asUser(userA, (tx) => tx`select * from public.append_user_message(${conversation}, ${message}, 'hello')`);
    const [first] = await asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`);
    await asUser(userA, (tx) => tx`update public.messages set status = 'interrupted', content = 'partial' where id = ${first.id}`);
    const [second] = await asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`);
    expect(second.id).not.toBe(first.id);
    const stale = await asUser(userA, (tx) => tx`update public.messages set content = 'stale', status = 'complete' where id = ${first.id} and status = 'streaming' returning id`);
    expect(stale).toHaveLength(0);
    await asUser(userA, (tx) => tx`update public.messages set content = 'saved response', status = 'complete' where id = ${second.id} and status = 'streaming'`);
    const late = await asUser(userA, (tx) => tx`update public.messages set content = 'late', status = 'error' where id = ${second.id} and status = 'streaming' returning id`);
    expect(late).toHaveLength(0);
    const [replay] = await asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`);
    expect(replay).toMatchObject({ id: second.id, content: "saved response", status: "complete", replayed: true });
    const rows = await asUser(userA, (tx) => tx`select content, status from public.messages where conversation_id = ${conversation} order by position`);
    expect(rows).toEqual([{ content: "hello", status: "complete" }, { content: "saved response", status: "complete" }]);
  });

  it("recovers stale streaming rows and rejects owner violations and superseded prompts", async () => {
    const conversation = await newConversation();
    const message = randomUUID();
    await asUser(userA, (tx) => tx`select * from public.append_user_message(${conversation}, ${message}, 'hello')`);
    const [response] = await asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`);
    await asUser(userA, (tx) => tx`update public.messages set created_at = now() - interval '6 minutes' where id = ${response.id}`);
    await asUser(userA, (tx) => tx`select public.recover_stale_chat(${conversation})`);
    const [saved] = await asUser(userA, (tx) => tx`select content, status from public.messages where id = ${response.id}`);
    expect(saved).toEqual({ content: "Response stopped.", status: "interrupted" });
    await expect(asUser(userB, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`)).rejects.toMatchObject({ code: "PT404" });
    await expect(asUser(userB, (tx) => tx`select * from public.append_user_message(${conversation}, ${randomUUID()}, 'not owned')`)).rejects.toMatchObject({ code: "PT404" });
    await asUser(userA, (tx) => tx`select * from public.append_user_message(${conversation}, ${randomUUID()}, 'newer')`);
    await expect(asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`)).rejects.toMatchObject({ code: "PT409" });
  });
  async function answeredConversation(prompt = "hello", reply = "first answer") {
    const conversation = await newConversation();
    const message = randomUUID();
    await asUser(userA, (tx) => tx`select * from public.append_user_message(${conversation}, ${message}, ${prompt})`);
    const [claimed] = await asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`);
    await asUser(userA, (tx) => tx`update public.messages set content = ${reply}, status = 'complete' where id = ${claimed.id} and status = 'streaming'`);
    return { conversation, message, response: claimed.id as string };
  }

  it("regenerates a complete last response with a fresh UUID in the same position and fences the old one", async () => {
    const { conversation, message, response } = await answeredConversation();
    const [next] = await asUser(userA, (tx) => tx`select * from public.regenerate_assistant_message(${conversation}, ${message})`);
    expect(next).toMatchObject({ position: 2, content: "…", status: "streaming", replayed: false });
    expect(next.id).not.toBe(response);
    const stale = await asUser(userA, (tx) => tx`update public.messages set content = 'stale', status = 'complete' where id = ${response} and status = 'streaming' returning id`);
    expect(stale).toHaveLength(0);
    await expect(asUser(userA, (tx) => tx`select * from public.regenerate_assistant_message(${conversation}, ${message})`)).rejects.toMatchObject({ code: "PT409" });
    await expect(asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`)).rejects.toMatchObject({ code: "PT409" });
    await asUser(userA, (tx) => tx`update public.messages set content = 'second answer', status = 'complete' where id = ${next.id} and status = 'streaming'`);
    const rows = await asUser(userA, (tx) => tx`select role, content, status, position from public.messages where conversation_id = ${conversation} order by position`);
    expect(rows).toEqual([
      { role: "user", content: "hello", status: "complete", position: 1 },
      { role: "assistant", content: "second answer", status: "complete", position: 2 },
    ]);
  });

  it("regenerates an errored or missing response, and refuses superseded prompts and other owners", async () => {
    const { conversation, message, response } = await answeredConversation();
    await asUser(userA, (tx) => tx`update public.messages set status = 'error', content = 'Response unavailable.' where id = ${response}`);
    const [retry] = await asUser(userA, (tx) => tx`select * from public.regenerate_assistant_message(${conversation}, ${message})`);
    expect(retry).toMatchObject({ position: 2, status: "streaming" });
    await asUser(userA, (tx) => tx`delete from public.messages where id = ${retry.id}`);
    const [unanswered] = await asUser(userA, (tx) => tx`select * from public.regenerate_assistant_message(${conversation}, ${message})`);
    expect(unanswered).toMatchObject({ position: 2, status: "streaming" });
    await asUser(userA, (tx) => tx`update public.messages set status = 'complete', content = 'done' where id = ${unanswered.id}`);
    await expect(asUser(userB, (tx) => tx`select * from public.regenerate_assistant_message(${conversation}, ${message})`)).rejects.toMatchObject({ code: "PT404" });
    await asUser(userA, (tx) => tx`select * from public.append_user_message(${conversation}, ${randomUUID()}, 'newer')`);
    await expect(asUser(userA, (tx) => tx`select * from public.regenerate_assistant_message(${conversation}, ${message})`)).rejects.toMatchObject({ code: "PT409" });
  });

  it("edits only the latest user message, removes its reply, and keeps the auto title in sync", async () => {
    const { conversation, message } = await answeredConversation("original prompt");
    await asUser(userA, (tx) => tx`update public.conversations set title = 'original prompt' where id = ${conversation}`);
    const [edited] = await asUser(userA, (tx) => tx`select * from public.edit_last_user_message(${conversation}, ${message}, 'edited prompt')`);
    expect(edited).toEqual({ id: message, position: 1 });
    const rows = await asUser(userA, (tx) => tx`select role, content, position from public.messages where conversation_id = ${conversation} order by position`);
    expect(rows).toEqual([{ role: "user", content: "edited prompt", position: 1 }]);
    const [title] = await asUser(userA, (tx) => tx`select title from public.conversations where id = ${conversation}`);
    expect(title.title).toBe("edited prompt");
    const [again] = await asUser(userA, (tx) => tx`select * from public.edit_last_user_message(${conversation}, ${message}, 'edited prompt')`);
    expect(again).toEqual({ id: message, position: 1 });
    const [claimed] = await asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`);
    expect(claimed).toMatchObject({ position: 2, status: "streaming", replayed: false });
  });

  it("keeps a renamed title, and rejects edits while streaming, on older messages, blanks, and other owners", async () => {
    const { conversation, message } = await answeredConversation("keep my title");
    await asUser(userA, (tx) => tx`update public.conversations set title = 'Renamed by me' where id = ${conversation}`);
    await asUser(userA, (tx) => tx`select * from public.edit_last_user_message(${conversation}, ${message}, 'different prompt')`);
    const [title] = await asUser(userA, (tx) => tx`select title from public.conversations where id = ${conversation}`);
    expect(title.title).toBe("Renamed by me");
    await expect(asUser(userA, (tx) => tx`select * from public.edit_last_user_message(${conversation}, ${message}, '   ')`)).rejects.toMatchObject({ code: "PT400" });
    await expect(asUser(userA, (tx) => tx`select * from public.edit_last_user_message(${conversation}, ${message}, ${"x".repeat(20_001)})`)).rejects.toMatchObject({ code: "PT400" });
    await expect(asUser(userB, (tx) => tx`select * from public.edit_last_user_message(${conversation}, ${message}, 'not mine')`)).rejects.toMatchObject({ code: "PT404" });
    await asUser(userA, (tx) => tx`select * from public.claim_assistant_message(${conversation}, ${message})`);
    await expect(asUser(userA, (tx) => tx`select * from public.edit_last_user_message(${conversation}, ${message}, 'during stream')`)).rejects.toMatchObject({ code: "PT409" });
    const { conversation: other, message: first } = await answeredConversation("older");
    await asUser(userA, (tx) => tx`select * from public.append_user_message(${other}, ${randomUUID()}, 'newer')`);
    await expect(asUser(userA, (tx) => tx`select * from public.edit_last_user_message(${other}, ${first}, 'rewrite history')`)).rejects.toMatchObject({ code: "PT409" });
    const rows = await asUser(userA, (tx) => tx`select content from public.messages where conversation_id = ${other} order by position`);
    expect(rows.map((row) => row.content)).toEqual(["older", "first answer", "newer"]);
  });

  it("stores owner preferences, rejects another owner's access, and leaves conversation models alone", async () => {
    await asUser(userA, (tx) => tx`insert into public.user_preferences (user_id) values (${userA})`);
    const [created] = await asUser(userA, (tx) => tx`select preferred_name, preferred_language, default_model, response_length, response_style, about_you, recall_enabled from public.user_preferences`);
    expect(created).toEqual({
      preferred_name: null,
      preferred_language: "auto",
      default_model: "balanced",
      response_length: "balanced",
      response_style: "natural",
      about_you: null,
      recall_enabled: true,
    });

    const hidden = await asUser(userB, (tx) => tx`select user_id from public.user_preferences`);
    expect(hidden).toHaveLength(0);
    await expect(asUser(userB, (tx) => tx`insert into public.user_preferences (user_id, preferred_name) values (${userA}, 'nope')`)).rejects.toThrow();
    const stolen = await asUser(userB, (tx) => tx`update public.user_preferences set preferred_name = 'hijack' where user_id = ${userA} returning user_id`);
    const removed = await asUser(userB, (tx) => tx`delete from public.user_preferences where user_id = ${userA} returning user_id`);
    expect(stolen).toHaveLength(0);
    expect(removed).toHaveLength(0);
    await expect(asUser(userA, (tx) => tx`update public.user_preferences set user_id = ${userB}`)).rejects.toThrow();

    const [before] = await sql`select selected_model from public.conversations where id = ${conversationA}`;
    await asUser(userA, (tx) => tx`update public.user_preferences set preferred_language = 'id', default_model = 'fast', response_length = 'concise', response_style = 'direct', preferred_name = 'Habib', about_you = 'Builds Nibie' where user_id = ${userA}`);
    const [saved] = await asUser(userA, (tx) => tx`select preferred_language, default_model, response_length, response_style, preferred_name, about_you, updated_at from public.user_preferences`);
    expect(saved).toMatchObject({
      preferred_language: "id",
      default_model: "fast",
      response_length: "concise",
      response_style: "direct",
      preferred_name: "Habib",
      about_you: "Builds Nibie",
    });
    expect(saved.updated_at).toBeTruthy();
    const [after] = await sql`select selected_model from public.conversations where id = ${conversationA}`;
    expect(after.selected_model).toBe(before.selected_model);

    await expect(asUser(userA, (tx) => tx`update public.user_preferences set preferred_language = 'fr'`)).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`update public.user_preferences set default_model = 'turbo'`)).rejects.toThrow();
    await expect(asUser(userA, (tx) => tx`update public.user_preferences set preferred_name = ${"x".repeat(81)}`)).rejects.toThrow();
    const [still] = await asUser(userA, (tx) => tx`select preferred_language, default_model, preferred_name from public.user_preferences`);
    expect(still).toEqual({ preferred_language: "id", default_model: "fast", preferred_name: "Habib" });

    await asUser(userA, (tx) => tx`update public.user_preferences set recall_enabled = false where user_id = ${userA}`);
    const [recallOff] = await asUser(userA, (tx) => tx`select recall_enabled from public.user_preferences`);
    expect(recallOff.recall_enabled).toBe(false);
  });

  it("keeps memories owner-scoped and rejects cross-user reads and writes", async () => {
    const memoryA = randomUUID();
    const memoryB = randomUUID();
    await asUser(userA, (tx) => tx`
      insert into public.memories (id, user_id, type, content, normalized_key, source_conversation_id)
      values (${memoryA}, ${userA}, 'preference', 'I prefer TypeScript', 'i prefer typescript', ${conversationA})
    `);
    await sql`
      insert into public.memories (id, user_id, type, content, normalized_key)
      values (${memoryB}, ${userB}, 'fact', 'Secret fact', 'secret fact')
    `;

    const visible = await asUser(userA, (tx) => tx`select id, content from public.memories`);
    expect(visible).toEqual([{ id: memoryA, content: "I prefer TypeScript" }]);

    await expect(asUser(userA, (tx) => tx`
      insert into public.memories (user_id, type, content, normalized_key)
      values (${userB}, 'fact', 'Stolen', 'stolen')
    `)).rejects.toThrow();

    const hiddenUpdate = await asUser(userA, (tx) => tx`update public.memories set content = 'Hijacked' where id = ${memoryB} returning id`);
    const hiddenDelete = await asUser(userA, (tx) => tx`delete from public.memories where id = ${memoryB} returning id`);
    expect(hiddenUpdate).toHaveLength(0);
    expect(hiddenDelete).toHaveLength(0);

    const [stillPrivate] = await sql`select content from public.memories where id = ${memoryB}`;
    expect(stillPrivate.content).toBe("Secret fact");

    const lexical = await asUser(userA, (tx) => tx`select id, content from public.search_memories_lexical('TypeScript', 5)`);
    expect(lexical.map((row) => row.id)).toEqual([memoryA]);
    const lexicalHidden = await asUser(userB, (tx) => tx`select id from public.search_memories_lexical('TypeScript', 5)`);
    expect(lexicalHidden).toHaveLength(0);
  });

  it("keeps export and delete-all inside the caller, cascades messages, and leaves the account and preferences", async () => {
    const userC = randomUUID();
    const ownId = randomUUID();
    const ownMessage = randomUUID();
    await sql`insert into auth.users (id) values (${userC})`;
    await asUser(userA, async (tx) => {
      await tx`insert into public.conversations (id, user_id, title, selected_model) values (${ownId}, ${userA}, 'Export me', 'Reasoning')`;
      await tx`insert into public.messages (id, conversation_id, user_id, role, content, status, position) values (${ownMessage}, ${ownId}, ${userA}, 'user', 'only mine', 'complete', 1)`;
    });

    const visibleConversations = await asUser(userA, (tx) => tx`select id, title, selected_model, created_at, updated_at from public.conversations`);
    const visibleMessages = await asUser(userA, (tx) => tx`select id, conversation_id, role, content, status, position, created_at, reply_to_message_id from public.messages`);
    const exported = buildConversationExport({
      conversations: [...visibleConversations] as ExportConversationRow[],
      messages: [...visibleMessages] as ExportMessageRow[],
      exportedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(exported?.exportVersion).toBe(1);
    expect(exported?.conversations.some((item) => item.id === ownId && item.selectedModel === "Reasoning" && item.messages.some((entry) => entry.content === "only mine"))).toBe(true);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain(conversationB);
    expect(serialized).not.toContain("private message");
    expect(serialized).not.toContain(userB);

    const emptyConversations = await asUser(userC, (tx) => tx`select id, title, selected_model, created_at, updated_at from public.conversations`);
    const emptyMessages = await asUser(userC, (tx) => tx`select id, conversation_id, role, content, status, position, created_at, reply_to_message_id from public.messages`);
    expect(buildConversationExport({
      conversations: [...emptyConversations] as ExportConversationRow[],
      messages: [...emptyMessages] as ExportMessageRow[],
      exportedAt: "2026-10-02T00:00:00.000Z",
    })).toEqual({
      product: "Nibie",
      exportVersion: 1,
      exportedAt: "2026-10-02T00:00:00.000Z",
      conversations: [],
    });

    const crossDelete = await asUser(userA, (tx) => tx`delete from public.conversations where id = ${conversationB} returning id`);
    expect(crossDelete).toHaveLength(0);
    const removed = await asUser(userA, (tx) => tx`delete from public.conversations where user_id = (select auth.uid()) returning id`);
    expect(removed.map((row) => row.id)).toContain(ownId);
    expect(removed.map((row) => row.id)).not.toContain(conversationB);

    expect(await sql`select id from public.messages where id = ${ownMessage}`).toHaveLength(0);
    expect(await sql`select content from public.messages where id = ${messageB}`).toEqual([{ content: "private message" }]);
    expect(await sql`select title from public.conversations where id = ${conversationB}`).toEqual([{ title: "B conversation" }]);
    expect(await sql`select id from public.users where id = ${userA}`).toEqual([{ id: userA }]);
    expect(await sql`select preferred_name from public.user_preferences where user_id = ${userA}`).toEqual([{ preferred_name: "Habib" }]);
  });

  describe("chat attachments", () => {
    const owner = randomUUID();
    const stranger = randomUUID();
    const thread = randomUUID();
    const otherThread = randomUUID();
    const strangerThread = randomUUID();

    async function draft(userId: string, name = "attachment-a.txt", size = 64, text = "The internal codename for this test document is Cedar Harbor.") {
      const [row] = await asUser(userId, (tx) => tx`insert into public.message_attachments (user_id, original_name, mime_type, size_bytes, extracted_text)
        values (${userId}, ${name}, 'text/plain', ${size}, ${text}) returning id`);
      return row.id as string;
    }
    const send = (userId: string, conversation: string, message: string, ids: string[], content = "What is the codename?") =>
      asUser(userId, (tx) => tx`select * from public.append_user_message_with_attachments(${conversation}, ${message}, ${content}, ${ids}::uuid[])`);

    beforeAll(async () => {
      await sql`insert into auth.users (id) values (${owner}), (${stranger})`;
      await sql`insert into public.conversations (id, user_id, title) values (${thread}, ${owner}, 'Attachments'), (${otherThread}, ${owner}, 'Other'), (${strangerThread}, ${stranger}, 'Stranger')`;
    });

    it("has row-level security enabled and forced on the attachments table", async () => {
      expect(await sql`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.message_attachments'::regclass`).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    });

    it("links a draft to the user message it was sent with, in one step, and keeps it for a reload", async () => {
      const first = await draft(owner);
      const second = await draft(owner, "attachment-b.md");
      const message = randomUUID();
      const [saved] = await send(owner, thread, message, [first, second]);
      expect(saved).toMatchObject({ id: message, position: 1 });
      const rows = await asUser(owner, (tx) => tx`select id, conversation_id, message_id, original_name from public.message_attachments where conversation_id = ${thread} order by created_at`);
      expect(rows.map((row) => [row.id, row.conversation_id, row.message_id])).toEqual([[first, thread, message], [second, thread, message]]);
      expect(rows.map((row) => row.original_name)).toEqual(["attachment-a.txt", "attachment-b.md"]);
    });

    it("treats a retried send as the same message and refuses a changed attachment set", async () => {
      const id = await draft(owner);
      const message = randomUUID();
      const [first] = await send(owner, thread, message, [id], "Retry me");
      const [again] = await send(owner, thread, message, [id], "Retry me");
      expect(again).toEqual(first);
      expect(await sql`select id from public.messages where id = ${message}`).toHaveLength(1);
      const extra = await draft(owner);
      await expect(send(owner, thread, message, [id, extra], "Retry me")).rejects.toMatchObject({ code: "PT409" });
      expect(await sql`select message_id from public.message_attachments where id = ${extra}`).toEqual([{ message_id: null }]);
    });

    it("never lets another conversation or another user claim an attachment", async () => {
      const id = await draft(owner);
      await send(owner, thread, randomUUID(), [id], "First use");
      const otherMessage = randomUUID();
      await expect(send(owner, otherThread, otherMessage, [id])).rejects.toMatchObject({ code: "PT409" });
      // The whole send rolled back: no message without its attachment.
      expect(await sql`select id from public.messages where id = ${otherMessage}`).toHaveLength(0);

      const ownersDraft = await draft(owner);
      const strangerMessage = randomUUID();
      await expect(send(stranger, strangerThread, strangerMessage, [ownersDraft])).rejects.toMatchObject({ code: "PT409" });
      expect(await sql`select id from public.messages where id = ${strangerMessage}`).toHaveLength(0);
      expect(await sql`select message_id from public.message_attachments where id = ${ownersDraft}`).toEqual([{ message_id: null }]);

      // Linking directly, outside the function, cannot reach another owner's or another conversation's message either.
      const [strangerOwn] = await asUser(stranger, (tx) => tx`select * from public.append_user_message(${strangerThread}, ${randomUUID()}, 'Mine')`);
      await expect(asUser(owner, (tx) => tx`update public.message_attachments set conversation_id = ${strangerThread}, message_id = ${strangerOwn.id} where id = ${ownersDraft}`)).rejects.toThrow();
      const ownMessage = (await sql`select id from public.messages where conversation_id = ${thread} order by position limit 1`)[0].id;
      await expect(asUser(owner, (tx) => tx`update public.message_attachments set conversation_id = ${otherThread}, message_id = ${ownMessage} where id = ${ownersDraft}`)).rejects.toThrow();
    });

    it("keeps attachments invisible and untouchable for other users", async () => {
      const id = await draft(owner);
      expect(await asUser(stranger, (tx) => tx`select id from public.message_attachments where id = ${id}`)).toHaveLength(0);
      expect(await asUser(stranger, (tx) => tx`delete from public.message_attachments where id = ${id} returning id`)).toHaveLength(0);
      await expect(asUser(stranger, (tx) => tx`insert into public.message_attachments (user_id, original_name, mime_type, size_bytes, extracted_text) values (${owner}, 'x.txt', 'text/plain', 1, 'x')`)).rejects.toThrow();
      expect(await sql`select id from public.message_attachments where id = ${id}`).toHaveLength(1);
    });

    it("creates drafts only unlinked, removes only drafts, and never unlinks a sent attachment", async () => {
      const ownMessage = (await sql`select id from public.messages where conversation_id = ${thread} order by position limit 1`)[0].id;
      await expect(asUser(owner, (tx) => tx`insert into public.message_attachments (user_id, conversation_id, message_id, original_name, mime_type, size_bytes, extracted_text) values (${owner}, ${thread}, ${ownMessage}, 'x.txt', 'text/plain', 1, 'x')`)).rejects.toThrow();
      const removable = await draft(owner);
      expect(await asUser(owner, (tx) => tx`delete from public.message_attachments where id = ${removable} returning id`)).toHaveLength(1);
      const [linked] = await sql`select id from public.message_attachments where message_id is not null and user_id = ${owner} limit 1`;
      expect(await asUser(owner, (tx) => tx`delete from public.message_attachments where id = ${linked.id} returning id`)).toHaveLength(0);
      expect(await asUser(owner, (tx) => tx`update public.message_attachments set conversation_id = null, message_id = null where id = ${linked.id} returning id`)).toHaveLength(0);
      await expect(asUser(owner, (tx) => tx`update public.message_attachments set extracted_text = 'changed' where id = ${linked.id}`)).rejects.toThrow();
    });

    it("saves nothing when an attachment is missing or the set is too large", async () => {
      const missing = randomUUID();
      const message = randomUUID();
      await expect(send(owner, thread, message, [missing])).rejects.toMatchObject({ code: "PT409" });
      expect(await sql`select id from public.messages where id = ${message}`).toHaveLength(0);
      const big = [await draft(owner, "a.txt", 3_000_000), await draft(owner, "b.txt", 3_000_000), await draft(owner, "c.txt", 3_000_000)];
      const tooLarge = randomUUID();
      await expect(send(owner, thread, tooLarge, big)).rejects.toMatchObject({ code: "PT413" });
      expect(await sql`select id from public.messages where id = ${tooLarge}`).toHaveLength(0);
      expect(await sql`select count(*)::int as n from public.message_attachments where id = any(${big}::uuid[]) and message_id is null`).toEqual([{ n: 3 }]);
      await expect(send(owner, thread, randomUUID(), [big[0], big[1], big[2], randomUUID()])).rejects.toMatchObject({ code: "PT400" });
    });

    it("removes sent attachments with their conversation", async () => {
      const id = await draft(owner);
      await send(owner, otherThread, randomUUID(), [id], "In the other thread");
      await asUser(owner, (tx) => tx`delete from public.conversations where id = ${otherThread}`);
      expect(await sql`select id from public.message_attachments where id = ${id}`).toHaveLength(0);
    });
  });

  describe("thread summaries", () => {
    const owner = randomUUID();
    const stranger = randomUUID();
    const thread = randomUUID();
    const strangerThread = randomUUID();
    const fields = ["Objective", "Context", "Decisions", "Done", "State", "Questions"];

    const save = (userId: string, conversation: string, coverage: number, objective = "Objective") =>
      asUser(userId, (tx) => tx`select public.save_thread_summary(${conversation}::uuid, ${objective}, ${fields[1]}, ${fields[2]}, ${fields[3]}, ${fields[4]}, ${fields[5]}, ${coverage}::integer) as saved`)
        .then(([row]) => row.saved as boolean);
    const stored = (conversation: string) => sql`select user_id, objective, covers_through_position from public.thread_summaries where conversation_id = ${conversation}`;

    beforeAll(async () => {
      await sql`insert into auth.users (id) values (${owner}), (${stranger})`;
      await sql`insert into public.conversations (id, user_id, title) values (${thread}, ${owner}, 'Summarized'), (${strangerThread}, ${stranger}, 'Stranger')`;
      for (const [conversation, userId] of [[thread, owner], [strangerThread, stranger]]) {
        for (let position = 1; position <= 30; position++) {
          await sql`insert into public.messages (conversation_id, user_id, role, content, position)
            values (${conversation}, ${userId}, ${position % 2 === 1 ? "user" : "assistant"}, ${`turn ${position}`}, ${position})`;
        }
      }
    });

    it("has row-level security enabled and forced", async () => {
      const [table] = await sql`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.thread_summaries'::regclass`;
      expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    });

    it("lets the owner write and read one summary per conversation without touching messages", async () => {
      expect(await save(owner, thread, 13)).toBe(true);
      expect(await asUser(owner, (tx) => tx`select objective, important_context, covers_through_position from public.thread_summaries`))
        .toEqual([{ objective: "Objective", important_context: "Context", covers_through_position: 13 }]);
      expect(await stored(thread)).toEqual([{ user_id: owner, objective: "Objective", covers_through_position: 13 }]);
      expect(await sql`select count(*)::int as n from public.messages where conversation_id = ${thread}`).toEqual([{ n: 30 }]);
    });

    it("only moves coverage forward and discards an older candidate", async () => {
      expect(await save(owner, thread, 21, "Newer")).toBe(true);
      expect(await save(owner, thread, 13, "Older job")).toBe(false);
      expect(await save(owner, thread, 21, "Same coverage")).toBe(false);
      expect(await stored(thread)).toEqual([{ user_id: owner, objective: "Newer", covers_through_position: 21 }]);
      await expect(asUser(owner, (tx) => tx`update public.thread_summaries set covers_through_position = 5 where conversation_id = ${thread}`)).rejects.toMatchObject({ code: "PT409" });
      await expect(asUser(owner, (tx) => tx`update public.thread_summaries set user_id = ${stranger} where conversation_id = ${thread}`)).rejects.toThrow();
      await expect(save(owner, thread, 0)).rejects.toThrow();
      expect(await stored(thread)).toEqual([{ user_id: owner, objective: "Newer", covers_through_position: 21 }]);
    });

    it("keeps the newest coverage when first inserts race", async () => {
      const raced = randomUUID();
      await sql`insert into public.conversations (id, user_id, title) values (${raced}, ${owner}, 'Race')`;
      const results = await Promise.all([save(owner, raced, 9, "Nine"), save(owner, raced, 17, "Seventeen"), save(owner, raced, 13, "Thirteen")]);
      expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(1);
      expect(await stored(raced)).toEqual([{ user_id: owner, objective: "Seventeen", covers_through_position: 17 }]);
    });

    it("denies other users every read and write", async () => {
      expect(await save(stranger, strangerThread, 9)).toBe(true);
      expect(await asUser(owner, (tx) => tx`select conversation_id from public.thread_summaries where conversation_id = ${strangerThread}`)).toEqual([]);
      expect(await asUser(stranger, (tx) => tx`select conversation_id from public.thread_summaries where conversation_id = ${thread}`)).toEqual([]);
      // Writing into another owner's conversation fails the owner foreign key, whatever user_id is claimed.
      await expect(save(stranger, thread, 29, "Hijack")).rejects.toMatchObject({ code: "PT404" });
      await expect(asUser(stranger, (tx) => tx`insert into public.thread_summaries (conversation_id, user_id, objective, important_context, decisions, completed_work, current_state, open_questions, covers_through_position)
        values (${randomUUID()}, ${owner}, 'x', 'x', 'x', 'x', 'x', 'x', 1)`)).rejects.toThrow();
      expect(await asUser(stranger, (tx) => tx`update public.thread_summaries set covers_through_position = 29 where conversation_id = ${thread} returning conversation_id`)).toHaveLength(0);
      expect(await asUser(stranger, (tx) => tx`delete from public.thread_summaries where conversation_id = ${thread} returning conversation_id`)).toHaveLength(0);
      await expect(asUser(randomUUID(), (tx) => tx`select public.save_thread_summary(${thread}::uuid, 'a', 'b', 'c', 'd', 'e', 'f', 29)`)).rejects.toThrow();
      expect(await stored(thread)).toEqual([{ user_id: owner, objective: "Newer", covers_through_position: 21 }]);
    });

    it("deletes the summary with its conversation", async () => {
      await asUser(owner, (tx) => tx`delete from public.conversations where id = ${thread}`);
      expect(await stored(thread)).toEqual([]);
      expect(await stored(strangerThread)).toHaveLength(1);
    });
  });

  it("keeps message_research owner-scoped and rejects cross-user reads and writes", async () => {
    // Fresh conversations — suite conversationA may already be gone after export/delete-all.
    const owner = randomUUID();
    const stranger = randomUUID();
    const thread = randomUUID();
    const strangerThread = randomUUID();
    const assistantOwn = randomUUID();
    const assistantStranger = randomUUID();

    expect(await sql`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.message_research'::regclass`).toEqual([
      { relrowsecurity: true, relforcerowsecurity: true },
    ]);

    await sql`insert into auth.users (id) values (${owner}), (${stranger})`;
    await sql`insert into public.conversations (id, user_id, title) values
      (${thread}, ${owner}, 'Research owner'),
      (${strangerThread}, ${stranger}, 'Research stranger')`;
    await sql`insert into public.messages (id, conversation_id, user_id, role, content, status, position) values
      (${assistantOwn}, ${thread}, ${owner}, 'assistant', 'research a', 'complete', 1),
      (${assistantStranger}, ${strangerThread}, ${stranger}, 'assistant', 'research b', 'complete', 1)`;

    await asUser(owner, (tx) => tx`
      insert into public.message_research (
        message_id, user_id, conversation_id, status, follow_up_used,
        search_query_count, pages_fetched, evidence_count, model_call_count, duration_ms, usage_policy
      ) values (
        ${assistantOwn}, ${owner}, ${thread}, 'complete', false,
        2, 1, 2, 2, 1200, 'temporary_undercount_v1'
      )
    `);
    await sql`
      insert into public.message_research (
        message_id, user_id, conversation_id, status, follow_up_used,
        search_query_count, pages_fetched, evidence_count, model_call_count, duration_ms, usage_policy
      ) values (
        ${assistantStranger}, ${stranger}, ${strangerThread}, 'complete', true,
        3, 2, 3, 2, 2400, 'temporary_undercount_v1'
      )
    `;

    const visible = await asUser(owner, (tx) => tx`
      select message_id, status, evidence_count from public.message_research where conversation_id = ${thread}
    `);
    expect(visible).toEqual([{ message_id: assistantOwn, status: "complete", evidence_count: 2 }]);

    await expect(asUser(owner, (tx) => tx`
      insert into public.message_research (
        message_id, user_id, conversation_id, status
      ) values (${assistantStranger}, ${owner}, ${strangerThread}, 'failed')
    `)).rejects.toThrow();

    const hiddenUpdate = await asUser(owner, (tx) => tx`
      update public.message_research set status = 'failed' where message_id = ${assistantStranger} returning message_id
    `);
    const hiddenDelete = await asUser(owner, (tx) => tx`
      delete from public.message_research where message_id = ${assistantStranger} returning message_id
    `);
    expect(hiddenUpdate).toHaveLength(0);
    expect(hiddenDelete).toHaveLength(0);

    const [stillPrivate] = await sql`select status, evidence_count from public.message_research where message_id = ${assistantStranger}`;
    expect(stillPrivate).toEqual({ status: "complete", evidence_count: 3 });

    await asUser(owner, (tx) => tx`delete from public.messages where id = ${assistantOwn}`);
    expect(await sql`select message_id from public.message_research where message_id = ${assistantOwn}`).toHaveLength(0);
    expect(await sql`select message_id from public.message_research where message_id = ${assistantStranger}`).toHaveLength(1);
  });

  it("keeps action_runs owner-scoped and server-written; rejects client forge/mutate/delete", async () => {
    const owner = randomUUID();
    const stranger = randomUUID();
    const thread = randomUUID();
    const strangerThread = randomUUID();
    const assistantOwn = randomUUID();
    const runStranger = randomUUID();

    expect(await sql`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.action_runs'::regclass`).toEqual([
      { relrowsecurity: true, relforcerowsecurity: true },
    ]);

    // Browser-equivalent authenticated role must not EXECUTE audit-write RPCs.
    expect(await sql`
      select
        has_function_privilege('authenticated', 'public.insert_action_run(uuid, uuid, text, text, text, text, uuid, uuid, jsonb)', 'execute') as insert_exec,
        has_function_privilege('authenticated', 'public.complete_action_run(uuid, uuid, text, text, jsonb)', 'execute') as complete_exec
    `).toEqual([{ insert_exec: false, complete_exec: false }]);
    expect(await sql`
      select
        has_function_privilege('service_role', 'public.insert_action_run(uuid, uuid, text, text, text, text, uuid, uuid, jsonb)', 'execute') as insert_exec,
        has_function_privilege('service_role', 'public.complete_action_run(uuid, uuid, text, text, jsonb)', 'execute') as complete_exec
    `).toEqual([{ insert_exec: true, complete_exec: true }]);

    await sql`insert into auth.users (id) values (${owner}), (${stranger})`;
    await sql`insert into public.conversations (id, user_id, title) values
      (${thread}, ${owner}, 'Actions owner'),
      (${strangerThread}, ${stranger}, 'Actions stranger')`;
    await sql`insert into public.messages (id, conversation_id, user_id, role, content, status, position) values
      (${assistantOwn}, ${thread}, ${owner}, 'assistant', 'reply', 'complete', 1)`;

    // Browser user calling either audit RPC directly is rejected (permission denied on EXECUTE).
    await expect(asUser(owner, (tx) => tx`
      select * from public.insert_action_run(
        ${owner}::uuid, ${thread}::uuid, 'web.search', 'read', '{"query":"forged via rpc"}', 'running',
        null::uuid, ${assistantOwn}::uuid, null::jsonb
      )
    `)).rejects.toThrow(/permission denied/i);
    await expect(asUser(owner, (tx) => tx`
      select public.complete_action_run(${randomUUID()}::uuid, ${randomUUID()}::uuid, 'completed', null, null::jsonb) as ok
    `)).rejects.toThrow(/permission denied/i);

    // Trusted Action Runtime path: service_role insert + complete with explicit owner.
    const inserted = await asServiceRole((tx) => tx`
      select * from public.insert_action_run(
        ${owner}::uuid, ${thread}::uuid, 'web.search', 'read', '{"query":"latest Node.js"}', 'running',
        null::uuid, ${assistantOwn}::uuid, null::jsonb
      )
    `);
    expect(inserted).toHaveLength(1);
    const runCompleted = inserted[0].id as string;
    expect(inserted[0].status).toBe("running");
    const [owned] = await sql`select user_id from public.action_runs where id = ${runCompleted}`;
    expect(owned.user_id).toBe(owner);
    await expect(asServiceRole((tx) => tx`
      select public.complete_action_run(${owner}::uuid, ${runCompleted}::uuid, 'completed', null, ${JSON.stringify({ itemCount: 1 })}::jsonb) as ok
    `)).resolves.toEqual([{ ok: true }]);

    const failedInsert = await asServiceRole((tx) => tx`
      select * from public.insert_action_run(
        ${owner}::uuid, ${thread}::uuid, 'web.search', 'read', '{"query":"news"}', 'running', null::uuid, ${assistantOwn}::uuid, null::jsonb
      )
    `);
    const runFailed = failedInsert[0].id as string;
    await asServiceRole((tx) => tx`select public.complete_action_run(${owner}::uuid, ${runFailed}::uuid, 'failed', 'execution_failed', null::jsonb)`);

    const cancelledInsert = await asServiceRole((tx) => tx`
      select * from public.insert_action_run(
        ${owner}::uuid, ${thread}::uuid, 'web.search', 'read', '{"query":"stopped"}', 'running', null::uuid, ${assistantOwn}::uuid, null::jsonb
      )
    `);
    const runCancelled = cancelledInsert[0].id as string;
    await asServiceRole((tx) => tx`select public.complete_action_run(${owner}::uuid, ${runCancelled}::uuid, 'cancelled', 'aborted', null::jsonb)`);

    // Superuser seed for stranger row (simulates another owner's server write).
    await sql`
      insert into public.action_runs (
        id, user_id, conversation_id, action_id, capability, input_summary, status, started_at, completed_at
      ) values (
        ${runStranger}, ${stranger}, ${strangerThread}, 'web.search', 'read', '{"query":"private"}', 'completed', now(), now()
      )
    `;

    const visible = await asUser(owner, (tx) => tx`
      select id, status, input_summary from public.action_runs where conversation_id = ${thread} order by status
    `);
    expect(visible).toHaveLength(3);
    expect(visible.map((row) => row.status).sort()).toEqual(["cancelled", "completed", "failed"]);
    expect(JSON.stringify(visible)).not.toMatch(/sk-|Bearer|api[_-]?key|cookie/i);

    const hidden = await asUser(owner, (tx) => tx`
      select id from public.action_runs where id = ${runStranger}
    `);
    expect(hidden).toHaveLength(0);

    // Direct client INSERT/UPDATE/DELETE must be rejected (no table grants / no forge path).
    await expect(asUser(owner, (tx) => tx`
      insert into public.action_runs (
        user_id, conversation_id, action_id, capability, input_summary, status
      ) values (${owner}, ${thread}, 'web.search', 'read', '{"query":"forged"}', 'completed')
    `)).rejects.toThrow(/permission denied/i);

    await expect(asUser(owner, (tx) => tx`
      update public.action_runs set status = 'failed' where id = ${runCompleted} returning id
    `)).rejects.toThrow(/permission denied/i);

    await expect(asUser(owner, (tx) => tx`
      delete from public.action_runs where id = ${runCompleted} returning id
    `)).rejects.toThrow(/permission denied/i);

    // Service-role RPC must not accept a forged terminal insert status.
    await expect(asServiceRole((tx) => tx`
      select * from public.insert_action_run(
        ${owner}::uuid, ${thread}::uuid, 'web.search', 'read', '{"query":"x"}', 'completed', null::uuid, null::uuid, null::jsonb
      )
    `)).rejects.toThrow();

    // Completing an already-terminal row is a no-op (append-only).
    await expect(asServiceRole((tx) => tx`
      select public.complete_action_run(${owner}::uuid, ${runCompleted}::uuid, 'failed', 'x', null::jsonb) as ok
    `)).resolves.toEqual([{ ok: false }]);

    // Reject overlong summaries at the DB check when over 240 chars.
    await expect(asServiceRole((tx) => tx`
      select * from public.insert_action_run(
        ${owner}::uuid, ${thread}::uuid, 'web.search', 'read', ${"x".repeat(241)}, 'running', null::uuid, null::uuid, null::jsonb
      )
    `)).rejects.toThrow();

    // Foreign room_id / message_id must fail ownership checks in the RPC.
    const foreignRoom = randomUUID();
    const foreignMessage = randomUUID();
    await sql`insert into public.rooms (id, user_id, name) values (${foreignRoom}, ${stranger}, 'Other room')`;
    await sql`insert into public.messages (id, conversation_id, user_id, role, content, status, position) values
      (${foreignMessage}, ${strangerThread}, ${stranger}, 'assistant', 'x', 'complete', 1)`;
    await expect(asServiceRole((tx) => tx`
      select * from public.insert_action_run(
        ${owner}::uuid, ${thread}::uuid, 'web.search', 'read', '{"query":"x"}', 'running', ${foreignRoom}::uuid, null::uuid, null::jsonb
      )
    `)).rejects.toThrow();
    await expect(asServiceRole((tx) => tx`
      select * from public.insert_action_run(
        ${owner}::uuid, ${thread}::uuid, 'web.search', 'read', '{"query":"x"}', 'running', null::uuid, ${foreignMessage}::uuid, null::jsonb
      )
    `)).rejects.toThrow();
  });
});
