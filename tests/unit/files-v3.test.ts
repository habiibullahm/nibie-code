import { afterEach, describe, expect, it, vi } from "vitest";
import { embedFileTexts } from "../../lib/files/embeddings";
import { fuseRoomFileCandidates, queryIdentifiers } from "../../lib/files/hybrid";
import { backfillRoomFileEmbeddings, searchRoomFiles } from "../../lib/files/search";
import { evaluateFixtures, fixtureCases, fixturePools, vector } from "../fixtures/files-v3";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const embeddingResponse = () => new Response(JSON.stringify({ data: [{ index: 0, embedding: vector(0) }] }));
it("requests the specified model and 512 dimensions once", async () => {
  vi.stubEnv("OPENAI_API_KEY", "mock-key");
  const fetcher = vi.fn().mockResolvedValue(embeddingResponse()); vi.stubGlobal("fetch", fetcher);
  expect(await embedFileTexts(["chunk"])).toEqual([vector(0)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: "text-embedding-3-small", dimensions: 512, encoding_format: "float", input: ["chunk"] });
});
it.each([[], [1], Array(512).fill(0)])("rejects malformed/zero embeddings", async (embedding) => {
  vi.stubEnv("OPENAI_API_KEY", "mock-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding }] }))));
  await expect(embedFileTexts(["chunk"])).rejects.toThrow();
});
it("maps provider indices rather than response order", async () => {
  vi.stubEnv("OPENAI_API_KEY", "mock-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 1, embedding: vector(1) }, { index: 0, embedding: vector(0) }] }))));
  expect(await embedFileTexts(["a", "b"])).toEqual([vector(0), vector(1)]);
});
it.each(["missing-key", "network", "http", "semantic-sql"])("degrades to lexical on %s", async (failure) => {
  vi.stubEnv("OPENAI_API_KEY", failure === "missing-key" ? "" : "mock-key");
  vi.stubGlobal("fetch", failure === "network" ? vi.fn().mockRejectedValue(new Error("network")) : vi.fn().mockResolvedValue(failure === "http" ? new Response("", { status: 429 }) : embeddingResponse()));
  const lexical = fixturePools(fixtureCases[0]).lexical.slice(0, 1);
  const rpc = vi.fn(async (name: string) => name === "search_room_file_chunks" ? { data: lexical, error: null } : { data: null, error: {} });
  const onSemanticFailure = vi.fn();
  expect(await searchRoomFiles({ rpc }, "current-room", fixtureCases[0].query, [], () => {}, onSemanticFailure)).toEqual(lexical);
  expect(rpc.mock.calls[0][0]).toBe("search_room_file_chunks");
  if (failure === "missing-key") expect(onSemanticFailure).not.toHaveBeenCalled();
  else expect(onSemanticFailure).toHaveBeenCalledOnce();
});
it("uses a tighter query embedding timeout and skips semantic without a key", async () => {
  vi.stubEnv("OPENAI_API_KEY", "mock-key");
  const fetcher = vi.fn().mockResolvedValue(embeddingResponse());
  vi.stubGlobal("fetch", fetcher);
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  await searchRoomFiles({ rpc }, "room", "deployment");
  expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  vi.stubEnv("OPENAI_API_KEY", "");
  const idle = vi.fn();
  vi.stubGlobal("fetch", idle);
  await searchRoomFiles({ rpc }, "room", "deployment");
  expect(idle).not.toHaveBeenCalled();
});
it("keeps selected files out before final five and removes duplicate chunks", () => {
  const { lexical, semantic } = fixturePools(fixtureCases[0]);
  const results = fuseRoomFileCandidates(fixtureCases[0].query, [...lexical, ...lexical], semantic, true, ["deploy"]);
  expect(results.some((c) => c.file_id === "deploy")).toBe(false);
  expect(new Set(results.map((c) => `${c.file_id}:${c.chunk_index}`)).size).toBe(results.length);
  expect(results.length).toBeLessThanOrEqual(5);
});
it("does not treat sentence punctuation as a code identifier", () => {
  expect(queryIdentifiers("Explain deployment pipeline.")).toEqual([]);
  expect(queryIdentifiers("Explain releaseBackend_v2 and `cache`.")).toEqual(["cache", "releaseBackend_v2"]);
});
it("protects lowercase function-call symbols from fuzzy neighbors", () => {
  const lexical = [{ file_id: "z-exact", chunk_index: 0, original_name: "src.java", content: "void render() {}", extracted_truncated: false }];
  const semantic = [{ file_id: "a-neighbor", chunk_index: 0, original_name: "src.java", content: "void renderList() {}", extracted_truncated: false, similarity: 0.99 }];
  expect(fuseRoomFileCandidates("How does render() work?", lexical, semantic).map((c) => c.file_id)).toEqual(["z-exact"]);
});
it("never lets malformed search data fail a reply", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  expect(await searchRoomFiles({ rpc: vi.fn().mockResolvedValue({ data: { id: "bad" }, error: null }) }, "room", "deployment")).toEqual([]);
});
it("uses current Room and bounds both candidate pools", async () => {
  vi.stubEnv("OPENAI_API_KEY", "mock-key"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(embeddingResponse()));
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  await searchRoomFiles({ rpc }, "current-room", "deployment");
  expect(rpc).toHaveBeenCalledWith("search_room_file_chunks", { p_room_id: "current-room", p_query: "deployment", p_limit: 10 });
  expect(rpc).toHaveBeenCalledWith("search_room_file_chunks_semantic", { p_room_id: "current-room", p_embedding: JSON.stringify(vector(0)), p_limit: 10 });
});
it("runs a bounded missing-only backfill without re-chunking", async () => {
  vi.stubEnv("OPENAI_API_KEY", "mock-key"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(embeddingResponse()));
  const rpc = vi.fn(async (name: string) => ({ data: name === "missing_room_file_embeddings" ? [{ id: "chunk-id", content: "existing chunk" }] : 1, error: null }));
  expect(await backfillRoomFileEmbeddings({ rpc }, "room", 100)).toBe(1);
  expect(rpc).toHaveBeenNthCalledWith(1, "missing_room_file_embeddings", { p_room_id: "room", p_limit: 20 });
  expect(rpc).toHaveBeenNthCalledWith(2, "fill_room_file_embeddings", { p_room_id: "room", p_rows: [{ id: "chunk-id", embedding: vector(0) }] });
});
it("empty backfill makes no embedding call", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await backfillRoomFileEmbeddings({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) }, "room")).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
});
describe("fixture-based retrieval evaluation (not live OpenAI)", () => {
  it("retrieves the required deployment paraphrase, preserves symbols, gates no-answer", () => {
    const report = evaluateFixtures();
    console.log("FIXTURE-BASED; local ranking/fusion latency only; live embedding/network latency UNMEASURED", JSON.stringify(report, null, 2));
    for (const mode of report.filter((r) => r.mode.startsWith("hybrid"))) {
      expect(mode.recallAt5).toBe(1);
      expect(mode.ranks[0].firstRelevantRank).toBeLessThanOrEqual(5);
      expect(mode.ranks[3].firstRelevantRank).toBe(1);
      expect(mode.noAnswerFalsePositives).toBe("0/3");
    }
  });
});
