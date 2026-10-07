import { describe, expect, it } from "vitest";
import { decideWebSearch, WEB_SEARCH_RULES } from "@/lib/web/routing";
import type { WebRouteReason } from "@/lib/web/types";

describe("decideWebSearch", () => {
  it("returns default_no_search for empty or whitespace queries", () => {
    expect(decideWebSearch("")).toEqual({ search: false, reason: "default_no_search" });
    expect(decideWebSearch("   \n\t  ")).toEqual({ search: false, reason: "default_no_search" });
  });

  describe("no-search cases (brief eval)", () => {
    it("skips conceptual explanations", () => {
      expect(decideWebSearch("Explain how HTTP works")).toEqual({
        search: false,
        reason: "conceptual",
      });
      expect(decideWebSearch("What is a binary search tree?")).toEqual({
        search: false,
        reason: "conceptual",
      });
      expect(decideWebSearch("Teach me the difference between TCP and UDP")).toEqual({
        search: false,
        reason: "conceptual",
      });
    });

    it("skips pure writing tasks", () => {
      expect(decideWebSearch("Rewrite this paragraph to sound warmer")).toEqual({
        search: false,
        reason: "pure_writing",
      });
      expect(decideWebSearch("Draft an email thanking my team")).toEqual({
        search: false,
        reason: "pure_writing",
      });
      expect(decideWebSearch("Edit the tone of this message")).toEqual({
        search: false,
        reason: "pure_writing",
      });
    });

    it("skips generic coding without currency or docs cues", () => {
      expect(decideWebSearch("Fix this TypeScript type error")).toEqual({
        search: false,
        reason: "generic_coding",
      });
      expect(decideWebSearch("Implement a debounce function in JavaScript")).toEqual({
        search: false,
        reason: "generic_coding",
      });
      expect(decideWebSearch("Help me refactor this Python class")).toEqual({
        search: false,
        reason: "generic_coding",
      });
    });

    it("does not search on weak tokens without currency cues (P1 false positives)", () => {
      expect(decideWebSearch("What is the difference between version control strategies?")).toEqual({
        search: false,
        reason: "conceptual",
      });
      expect(decideWebSearch("Fix the version check in this function")).toEqual({
        search: false,
        reason: "generic_coding",
      });
      expect(decideWebSearch("How should I price my consulting package?")).toEqual({
        search: false,
        reason: "default_no_search",
      });
      expect(decideWebSearch("Explain the concept of release trains")).toEqual({
        search: false,
        reason: "conceptual",
      });
      expect(decideWebSearch("What is a job queue in Node?")).toEqual({
        search: false,
        reason: "conceptual",
      });
    });

    it("skips Indonesian conceptual market asks without freshness or explicit web intent", () => {
      expect(decideWebSearch("apa itu IHSG?")).toEqual({
        search: false,
        reason: "conceptual",
      });
      expect(decideWebSearch("jelaskan IHSG")).toEqual({
        search: false,
        reason: "conceptual",
      });
      expect(decideWebSearch("jelaskan cara kerja pasar saham")).toEqual({
        search: false,
        reason: "conceptual",
      });
      expect(decideWebSearch("apa itu indeks saham?")).toEqual({
        search: false,
        reason: "conceptual",
      });
    });
  });

  describe("search cases (brief eval)", () => {
    it("searches for current version / release queries", () => {
      expect(decideWebSearch("What is the latest version of Next.js?")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
      expect(decideWebSearch("Show me the changelog for React 19")).toEqual({
        search: true,
        reason: "releases_versions",
      });
      expect(decideWebSearch("What's new in Node 22")).toEqual({
        search: true,
        reason: "releases_versions",
      });
    });

    it("searches for news queries", () => {
      expect(decideWebSearch("What are today's tech headlines?")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
      expect(decideWebSearch("Any breaking news about OpenAI?")).toEqual({
        search: true,
        reason: "news",
      });
    });

    it("searches for current CEO / public figure queries", () => {
      expect(decideWebSearch("Who is the current CEO of Microsoft?")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
      expect(decideWebSearch("Who is the CEO of Stripe?")).toEqual({
        search: true,
        reason: "public_figures",
      });
    });

    it("searches on explicit web/search requests", () => {
      expect(decideWebSearch("Search the web for best espresso machines")).toEqual({
        search: true,
        reason: "explicit_request",
      });
      expect(decideWebSearch("Can you google the population of Jakarta?")).toEqual({
        search: true,
        reason: "explicit_request",
      });
      expect(decideWebSearch("Look up online whether TypeScript 5.7 is out")).toEqual({
        search: true,
        reason: "explicit_request",
      });
    });

    it("searches on Indonesian explicit web intent", () => {
      expect(decideWebSearch("coba cari web soal IHSG")).toEqual({
        search: true,
        reason: "explicit_request",
      });
      expect(decideWebSearch("cari di web harga IHSG")).toEqual({
        search: true,
        reason: "explicit_request",
      });
      expect(decideWebSearch("cek online berita pasar")).toEqual({
        search: true,
        reason: "explicit_request",
      });
      expect(decideWebSearch("telusuri web soal BBCA")).toEqual({
        search: true,
        reason: "explicit_request",
      });
    });

    it("searches Indonesian market asks with freshness cues", () => {
      expect(decideWebSearch("analisa IHSG hari ini")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
      expect(decideWebSearch("arah IHSG saat ini")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
      expect(decideWebSearch("IHSG terbaru gimana?")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
      expect(decideWebSearch("harga saham BBCA sekarang")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
      expect(decideWebSearch("update pasar saham terkini")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
    });

    it("searches Indonesian market condition/direction asks without an explicit freshness cue", () => {
      expect(decideWebSearch("bagaimana kondisi IHSG dan arah pasar saham?")).toEqual({
        search: true,
        reason: "prices_markets",
      });
      expect(decideWebSearch("kondisi IHSG")).toEqual({
        search: true,
        reason: "prices_markets",
      });
      expect(decideWebSearch("arah IHSG")).toEqual({
        search: true,
        reason: "prices_markets",
      });
      expect(decideWebSearch("IHSG anjlok kenapa?")).toEqual({
        search: true,
        reason: "prices_markets",
      });
      expect(decideWebSearch("pergerakan IHSG")).toEqual({
        search: true,
        reason: "prices_markets",
      });
      // Bare market topic without condition or currency still skips (cost-conscious).
      expect(decideWebSearch("saya pegang saham BBCA")).toEqual({
        search: false,
        reason: "default_no_search",
      });
    });

    it("searches prices, schedules, jobs, and current docs", () => {
      expect(decideWebSearch("What is the Bitcoin price?")).toEqual({
        search: true,
        reason: "prices_markets",
      });
      expect(decideWebSearch("When is the kickoff for the match?")).toEqual({
        search: true,
        reason: "schedules",
      });
      expect(decideWebSearch("Are there open roles or job postings at Vercel?")).toEqual({
        search: true,
        reason: "jobs",
      });
      expect(decideWebSearch("Show me the official docs for the Stripe API")).toEqual({
        search: true,
        reason: "current_docs",
      });
    });

    it("searches weak version/price/job tokens only with currency cues", () => {
      expect(decideWebSearch("What is the current price of consulting packages in NYC?")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
      expect(decideWebSearch("What is the latest release of Next.js?")).toEqual({
        search: true,
        reason: "temporal_currency",
      });
    });

    it("searches stale public-info patterns only with currency cues", () => {
      expect(decideWebSearch("What is the current market share of Android?")).toEqual({
        search: true,
        reason: "public_info_stale",
      });
      expect(decideWebSearch("What is the market share of Android?")).toEqual({
        search: false,
        reason: "conceptual",
      });
    });
  });

  describe("Room-only vs Room+web", () => {
    it("skips web for Room-grounded asks when file context is present", () => {
      expect(
        decideWebSearch("Based on this file, what are the main risks?", {
          hasRoomFileContext: true,
        }),
      ).toEqual({ search: false, reason: "room_sufficient" });
      expect(
        decideWebSearch("Summarize this document using only the room file", {
          hasRoomFileContext: true,
        }),
      ).toEqual({ search: false, reason: "room_sufficient" });
      expect(
        decideWebSearch("In this room, list the action items from the attached file", {
          hasRoomFileContext: true,
        }),
      ).toEqual({ search: false, reason: "room_sufficient" });
    });

    it("still searches when Room files exist but the ask needs current external info", () => {
      expect(
        decideWebSearch("What is the latest release of the library mentioned in our notes?", {
          hasRoomFileContext: true,
        }),
      ).toEqual({ search: true, reason: "temporal_currency" });
      expect(
        decideWebSearch("Any recent news about competitors we should know?", {
          hasRoomFileContext: true,
        }),
      ).toEqual({ search: true, reason: "temporal_currency" });
    });

    it("does not treat room phrasing as sufficient without file context", () => {
      expect(
        decideWebSearch("Based on this file, summarize the attached notes", {
          hasRoomFileContext: false,
        }),
      ).toEqual({ search: false, reason: "default_no_search" });
    });

    it("honors explicit search even when room file context is present", () => {
      expect(
        decideWebSearch("Search the web for alternatives to the approach in this file", {
          hasRoomFileContext: true,
        }),
      ).toEqual({ search: true, reason: "explicit_request" });
    });
  });

  describe("WEB_SEARCH_RULES table", () => {
    it("exports a stable search-reason table for tests and tuning", () => {
      const reasons = WEB_SEARCH_RULES.map((rule) => rule.reason);
      const expected: WebRouteReason[] = [
        "explicit_request",
        "temporal_currency",
        "news",
        "prices_markets",
        "schedules",
        "releases_versions",
        "public_figures",
        "current_docs",
        "jobs",
        "public_info_stale",
      ];
      expect(reasons).toEqual(expected);
      expect(WEB_SEARCH_RULES.every((rule) => rule.search)).toBe(true);
    });
  });
});
