import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { afterMock, providerStream } = vi.hoisted(() => ({ afterMock: vi.fn(), providerStream: vi.fn() }));
vi.mock("next/server", () => ({ after: afterMock }));
vi.mock("@/lib/ai/provider", () => ({ chatProvider: { stream: providerStream } }));

import { deferThreadSummaryMaintenance, loadThreadSummary, runThreadSummaryMaintenance } from "../../lib/context/thread-summary-store";

const conversationId = "5e9bdcca-9205-4fea-a773-13952bb78c44";
const encoder = new TextEncoder();
const secret = "classified-launch-codename";
const validOutput = { objective: "Plan the launch", importantContext: "Budget is fixed", decisions: "Use Postgres", completedWork: "Schema drafted", currentState: "Writing tests", openQuestions: "Pricing" };
const storedRow = (coverage: number) => ({
  objective: "Old objective", important_context: "Old context", decisions: "Old decisions", completed_work: "Old work",
  current_state: "Old state", open_questions: "Old questions", covers_through_position: coverage, updated_at: "2026-10-05T00:00:00.000Z",
});

type Result = { data?: unknown; error?: unknown; count?: number | null };
type Fake = {
  summary: Result;
  count: Result;
  rows: { role: string; content: string; position: number }[];
  rowsError?: unknown;
  save: Result;
  reads: { table: string; filters: unknown[][] }[];
  rpcCalls: { name: string; args: Record<string, unknown> }[];
};

function fakeClient(state: Fake) {
  const from = (table: string) => {
    const filters: unknown[][] = [];
    let head = false;
    const builder: Record<string, unknown> = {};
    builder.select = (_columns: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return builder; };
    for (const method of ["eq", "gt", "lte", "order", "limit"]) builder[method] = (...args: unknown[]) => { filters.push([method, ...args]); return builder; };
    const resolve = (): Result => {
      state.reads.push({ table, filters });
      if (table === "thread_summaries") return state.summary;
      if (head) return state.count;
      if (state.rowsError) return { data: null, error: state.rowsError };
      const after = filters.find((filter) => filter[0] === "gt")?.[2] as number;
      const through = filters.find((filter) => filter[0] === "lte")?.[2] as number;
      return { data: state.rows.filter((row) => row.position > after && row.position <= through), error: null };
    };
    builder.maybeSingle = async () => resolve();
    builder.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled);
    return builder;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => { state.rpcCalls.push({ name, args }); return state.save; };
  return { from, rpc } as unknown as Parameters<typeof loadThreadSummary>[0];
}

function thread(count: number) {
  return Array.from({ length: count }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: `${secret} message ${index + 1}`, position: index + 1 }));
}

function state(overrides: Partial<Fake> = {}): Fake {
  return {
    summary: { data: null, error: null }, count: { count: 26, error: null }, rows: thread(26), save: { data: true, error: null },
    reads: [], rpcCalls: [], ...overrides,
  };
}

function providerReply(text: string) {
  return new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`));
    controller.close();
  } });
}

const logs: string[] = [];
function events() {
  return logs.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("thread summary store", () => {
  beforeEach(() => {
    logs.length = 0;
    for (const level of ["info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => { logs.push(String(line)); });
    afterMock.mockReset();
    providerStream.mockReset().mockImplementation(async () => providerReply(JSON.stringify(validOutput)));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // Nothing in this module may ever write conversation or summary text to logs.
    expect(logs.join("\n")).not.toContain(secret);
    expect(logs.join("\n")).not.toContain("Old objective");
    expect(logs.join("\n")).not.toContain("Plan the launch");
  });

  describe("loading for a chat request", () => {
    it("maps the stored row", async () => {
      const summary = await loadThreadSummary(fakeClient(state({ summary: { data: storedRow(15), error: null } })), conversationId, "req-1");
      expect(summary).toEqual({
        objective: "Old objective", importantContext: "Old context", decisions: "Old decisions", completedWork: "Old work",
        currentState: "Old state", openQuestions: "Old questions", coversThroughPosition: 15, updatedAt: "2026-10-05T00:00:00.000Z",
      });
    });

    it("returns null when the conversation has no summary", async () => {
      expect(await loadThreadSummary(fakeClient(state()), conversationId, "req-1")).toBeNull();
      expect(events()).toEqual([]);
    });

    it("degrades a failed or malformed read to null and reports it", async () => {
      expect(await loadThreadSummary(fakeClient(state({ summary: { data: null, error: { code: "XX000", message: secret } } })), conversationId, "req-1")).toBeNull();
      expect(await loadThreadSummary(fakeClient(state({ summary: { data: { ...storedRow(15), objective: 4 }, error: null } })), conversationId, "req-2")).toBeNull();
      const thrower = { from: () => { throw new Error(secret); } } as unknown as Parameters<typeof loadThreadSummary>[0];
      expect(await loadThreadSummary(thrower, conversationId, "req-3")).toBeNull();
      expect(events().map((event) => [event.event, event.reason])).toEqual([
        ["thread_summary.read.failed", "read_failed"],
        ["thread_summary.read.failed", "invalid_row"],
        ["thread_summary.read.failed", "read_failed"],
      ]);
    });

    it("treats a database without the table as having no summary", async () => {
      expect(await loadThreadSummary(fakeClient(state({ summary: { data: null, error: { code: "PGRST205" } } })), conversationId, "req-1")).toBeNull();
      expect(events()).toEqual([]);
    });
  });

  describe("maintenance", () => {
    const run = (fake: Fake, assistantPosition = 26) => runThreadSummaryMaintenance({ supabase: fakeClient(fake), conversationId, assistantPosition, requestId: "req-1" });

    it("skips a thread below the threshold without calling the provider", async () => {
      const fake = state({ count: { count: 12, error: null }, rows: thread(12) });
      await run(fake, 12);
      expect(providerStream).not.toHaveBeenCalled();
      expect(fake.rpcCalls).toEqual([]);
      expect(events().at(-1)).toMatchObject({ event: "thread_summary.refresh.skipped", reason: "below_threshold" });
    });

    it("writes the initial summary over messages through the target", async () => {
      const fake = state();
      await run(fake, 26);
      const prompt = JSON.parse(providerStream.mock.calls[0][1][1].content) as { existingSummary: unknown; newMessages: { position: number }[] };
      expect(providerStream.mock.calls[0][0]).toBe("Fast");
      expect(prompt.existingSummary).toBeNull();
      expect(prompt.newMessages.map((message) => message.position)).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
      expect(fake.rpcCalls).toEqual([{ name: "save_thread_summary", args: {
        p_conversation_id: conversationId, p_objective: "Plan the launch", p_important_context: "Budget is fixed", p_decisions: "Use Postgres",
        p_completed_work: "Schema drafted", p_current_state: "Writing tests", p_open_questions: "Pricing", p_covers_through_position: 21,
      } }]);
      expect(events().map((event) => event.event)).toEqual(["thread_summary.refresh.started", "thread_summary.refresh.completed"]);
      expect(events()[1]).toMatchObject({ kind: "initial", coversThroughPosition: 21 });
    });

    it("refreshes incrementally from the stored summary and only the newer messages", async () => {
      const fake = state({ summary: { data: storedRow(13), error: null } });
      await run(fake, 26);
      const prompt = JSON.parse(providerStream.mock.calls[0][1][1].content) as { existingSummary: { objective: string }; newMessages: { position: number }[] };
      expect(prompt.existingSummary.objective).toBe("Old objective");
      expect(prompt.newMessages.map((message) => message.position)).toEqual([14, 15, 16, 17, 18, 19, 20, 21]);
      expect(fake.rpcCalls[0].args.p_covers_through_position).toBe(21);
    });

    it("skips while the refresh gap is below the threshold", async () => {
      const fake = state({ summary: { data: storedRow(15), error: null } });
      await run(fake, 26);
      expect(providerStream).not.toHaveBeenCalled();
      expect(events().at(-1)).toMatchObject({ event: "thread_summary.refresh.skipped", reason: "gap_below_threshold" });
    });

    it("discards a candidate when a newer summary was stored first", async () => {
      const fake = state({ save: { data: false, error: null } });
      await expect(run(fake)).resolves.toBeUndefined();
      expect(events().at(-1)).toMatchObject({ event: "thread_summary.refresh.skipped", reason: "superseded" });
    });

    it.each([
      ["provider failure", () => providerStream.mockRejectedValue(new Error(secret)), "provider_failed"],
      ["malformed output", () => providerStream.mockImplementation(async () => providerReply(`not json ${secret}`)), "malformed_output"],
      ["missing field", () => providerStream.mockImplementation(async () => providerReply(JSON.stringify({ objective: secret }))), "invalid_shape"],
    ] as const)("leaves the stored summary alone after a %s", async (_name, arrange, reason) => {
      arrange();
      const fake = state();
      await expect(run(fake)).resolves.toBeUndefined();
      expect(fake.rpcCalls).toEqual([]);
      expect(events().at(-1)).toMatchObject({ event: "thread_summary.refresh.failed", reason });
    });

    it("reports read and save failures without throwing", async () => {
      await expect(run(state({ count: { count: null, error: { code: "XX000" } } }))).resolves.toBeUndefined();
      await expect(run(state({ rowsError: { code: "XX000" } }))).resolves.toBeUndefined();
      await expect(run(state({ save: { data: null, error: { code: "PT409", message: secret } } }))).resolves.toBeUndefined();
      expect(events().filter((event) => event.event === "thread_summary.refresh.failed").map((event) => event.stage)).toEqual(["count", "messages", "save"]);
    });
  });

  describe("deferred scheduling", () => {
    const fakeJob = (fake: Fake) => ({ supabase: fakeClient(fake), conversationId, requestId: "req-1" });

    it("runs maintenance after the response only for a reply saved as complete", async () => {
      const fake = state();
      const deferred = deferThreadSummaryMaintenance(fakeJob(fake));
      expect(afterMock).toHaveBeenCalledOnce();
      deferred.complete(26);
      deferred.finish();
      await afterMock.mock.calls[0][0]();
      expect(fake.rpcCalls).toHaveLength(1);
    });

    it("does nothing when the reply ends any other way", async () => {
      const fake = state();
      const deferred = deferThreadSummaryMaintenance(fakeJob(fake));
      deferred.finish();
      deferred.complete(26);
      await afterMock.mock.calls[0][0]();
      expect(fake.reads).toEqual([]);
      expect(providerStream).not.toHaveBeenCalled();
    });

    it("never throws when after() is unavailable", () => {
      afterMock.mockImplementation(() => { throw new Error("outside a request scope"); });
      const deferred = deferThreadSummaryMaintenance(fakeJob(state()));
      expect(() => { deferred.complete(26); deferred.finish(); }).not.toThrow();
      expect(events().at(-1)).toMatchObject({ event: "thread_summary.refresh.skipped", reason: "after_unavailable" });
    });
  });
});
