import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createGenerationPersistence } from "@/lib/chat/orchestration/persist-result";
import { stoppedPlaceholder } from "@/lib/chat/stop";
import type { SourceReference } from "@/lib/citations/types";

vi.mock("@/lib/observability/logger", () => ({ logWarn: vi.fn() }));

const source: SourceReference = {
  id: "web:1", kind: "web", title: "Node.js", url: "https://nodejs.org", domain: "nodejs.org",
};

function fixture(status = "streaming", options: { writeError?: boolean; throwWrite?: boolean; readError?: boolean } = {}) {
  const row = { id: "assistant", content: "Seen text [1]", status };
  const inserts = vi.fn(async (): Promise<{ error: { code: string } | null }> => ({ error: null }));
  const updates: unknown[] = [];
  const from = (table: string) => {
    if (table === "message_sources") return { insert: inserts };
    const filters: [string, string][] = [];
    let write: { content: string; status: string } | undefined;
    const query = {
      update(value: typeof write) { write = value; return query; },
      eq(key: string, value: string) { filters.push([key, value]); return query; },
      select() { return query; },
      async maybeSingle() {
        if (write) {
          updates.push({ write, filters });
          if (options.throwWrite) throw new Error("database unavailable");
          if (options.writeError) return { data: null, error: { code: "XX000" } };
          if (!filters.every(([key, value]) => row[key as keyof typeof row] === value)) return { data: null, error: null };
          Object.assign(row, write);
          return { data: { id: row.id }, error: null };
        }
        return { data: row, error: options.readError ? { code: "XX000" } : null };
      },
    };
    return query;
  };
  let sources: SourceReference[] = [];
  const onFailure = vi.fn();
  const { persist, persistCitationSourcesForKeptReply } = createGenerationPersistence({
    supabase: { from } as unknown as SupabaseClient,
    userId: "owner", conversationId: "conversation", assistantId: row.id, requestId: "request",
    citationSources: () => sources,
    onFailure,
  });
  return { row, inserts, updates, onFailure, persist, persistCitationSourcesForKeptReply, setSources: (value: SourceReference[]) => { sources = value; } };
}

describe("generation persistence", () => {
  it.each(["complete", "interrupted"] as const)("saves a %s reply with sources prepared after the writer was created", async (status) => {
    const db = fixture();
    db.setSources([source]);
    await expect(db.persist("Answer [1]", status)).resolves.toBe("saved");
    expect(db.row).toMatchObject({ content: "Answer [1]", status });
    expect(db.updates).toEqual([{ write: { content: "Answer [1]", status }, filters: [["id", "assistant"], ["status", "streaming"]] }]);
    expect(db.inserts).toHaveBeenCalledWith([expect.objectContaining({ user_id: "owner", conversation_id: "conversation", message_id: "assistant", handle: "web:1" })]);
  });

  it.each(["complete", "interrupted", "error"] as const)("a late %s save keeps the Stop-owned text and attaches sources", async (status) => {
    const db = fixture("interrupted");
    db.setSources([source]);
    await expect(db.persist("More server text [1]", status)).resolves.toBe("stopped");
    expect(db.row).toMatchObject({ content: "Seen text [1]", status: "interrupted" });
    expect(db.inserts).toHaveBeenCalledTimes(1);
    expect(db.onFailure).not.toHaveBeenCalled();
  });

  it("does not attach sources to an error saved by the generation", async () => {
    const db = fixture();
    db.setSources([source]);
    await expect(db.persist("Response unavailable.", "error")).resolves.toBe("saved");
    expect(db.inserts).not.toHaveBeenCalled();
  });

  it.each(["", "  ", stoppedPlaceholder])("does not attach sources for an empty or placeholder partial (%j)", async (content) => {
    const db = fixture();
    db.setSources([source]);
    await expect(db.persist(content, "interrupted")).resolves.toBe("saved");
    expect(db.inserts).not.toHaveBeenCalled();
  });

  it("overlapping late saves insert sources only once, even while the first insert is pending", async () => {
    const db = fixture("interrupted");
    db.setSources([source]);
    let finishInsert!: (value: { error: null }) => void;
    db.inserts.mockImplementationOnce(() => new Promise((resolve) => { finishInsert = resolve; }));
    const first = db.persist("Partial [1]", "interrupted");
    await vi.waitFor(() => expect(db.inserts).toHaveBeenCalledTimes(1));
    await expect(db.persist("Partial [1]", "complete")).resolves.toBe("stopped");
    expect(db.inserts).toHaveBeenCalledTimes(1);
    finishInsert({ error: null });
    await expect(first).resolves.toBe("stopped");
  });

  it("a Stop already observed by the stream can attach sources without another message write", async () => {
    const db = fixture("interrupted");
    db.setSources([source]);
    await db.persistCitationSourcesForKeptReply("Partial [1]");
    await expect(db.persist("Late answer [1]", "complete")).resolves.toBe("stopped");
    expect(db.updates).toHaveLength(1);
    expect(db.row.content).toBe("Seen text [1]");
    expect(db.inserts).toHaveBeenCalledTimes(1);
  });

  it("retries a soft-failed citation insert on the next late save", async () => {
    const db = fixture("interrupted");
    db.setSources([source]);
    db.inserts.mockResolvedValueOnce({ error: { code: "XX000" } });
    await expect(db.persist("Partial [1]", "interrupted")).resolves.toBe("stopped");
    await expect(db.persist("Partial [1]", "complete")).resolves.toBe("stopped");
    expect(db.inserts).toHaveBeenCalledTimes(2);
  });

  it.each([{ writeError: true }, { throwWrite: true }, { readError: true }])("reports database failure without claiming a Stop or inserting sources (%j)", async (options) => {
    const db = fixture("interrupted", options);
    db.setSources([source]);
    await expect(db.persist("Late answer", "complete")).resolves.toBe("failed");
    expect(db.row.content).toBe("Seen text [1]");
    expect(db.inserts).not.toHaveBeenCalled();
    expect(db.onFailure).toHaveBeenCalledWith("complete");
  });

  it("does not replace an already completed answer or mistake it for a Stop", async () => {
    const db = fixture("complete");
    await expect(db.persist("Late answer", "complete")).resolves.toBe("failed");
    expect(db.row.content).toBe("Seen text [1]");
    expect(db.onFailure).toHaveBeenCalledWith("complete");
  });
});
