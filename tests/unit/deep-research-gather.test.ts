import { describe, expect, it } from "vitest";
import { gatherResearchSources } from "@/lib/research/gather";

describe("research source provenance", () => {
  it("dedupes redirected page evidence without refilling snippets from its original URLs", async () => {
    const finalUrl = "https://docs.example/current";
    const gathered = await gatherResearchSources(["current docs"], {
      signal: new AbortController().signal,
      provider: {
        id: "tavily",
        searchWeb: async () => ["old.example", "mirror.example"].map((domain, index) => ({
          url: `https://${domain}/docs`,
          title: "Docs",
          domain,
          rank: index + 1,
          snippet: "Original snippet",
        })),
      },
      fetchPage: async (url) => ({ url, finalUrl, contentType: "text/html", body: "<p>Fetched current docs</p>" }),
    });
    expect(gathered.pagesFetched).toBe(2);
    expect(gathered.sources).toHaveLength(1);
    expect(gathered.sources[0]).toMatchObject({ url: finalUrl, domain: "docs.example", retrieval: "web_search" });
  });
});
