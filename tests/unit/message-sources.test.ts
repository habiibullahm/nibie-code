import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageSources } from "../../components/message-sources";
import type { CitationSourceView } from "../../lib/citations/types";

const web = (ordinal: number, title: string, domain: string | null, url: string | null = `https://${domain}/page`): CitationSourceView => ({ ordinal, kind: "web", title, url, domain });
const render = (sources: CitationSourceView[]) => renderToStaticMarkup(createElement(MessageSources, { sources }));

describe("MessageSources", () => {
  it("renders nothing without sources", () => {
    expect(render([])).toBe("");
  });

  it("starts collapsed with a one-line summary of distinct domains, without www.", () => {
    const html = render([web(1, "Phone model", "www.reddit.com"), web(2, "Value check", "www.compareandrecycle.co.uk"), web(3, "Another thread", "www.reddit.com")]);
    expect(html).toMatch(/^<details class="message-sources"/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('<span class="message-sources-domains">reddit.com · compareandrecycle.co.uk</span>');
    expect(html).toContain('<span class="message-sources-count" aria-hidden="true">3</span>');
    expect(html).toContain('aria-label="Sources, 3"');
  });

  it("keeps every source in the markup so citation markers can target it once expanded", () => {
    const html = render([web(1, "First", "a.example"), web(2, "Second", "b.example")]);
    expect(html).toContain('id="citation-source-1"');
    expect(html).toContain('id="citation-source-2"');
    expect(html.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(2);
  });

  it("falls back to the title in the summary and never links unsafe URLs", () => {
    const html = render([web(1, "Local notes", null, "javascript:alert(1)")]);
    expect(html).toContain('<span class="message-sources-domains">Local notes</span>');
    expect(html).not.toContain("href=");
    expect(html).toContain('<span class="message-source-title">Local notes</span>');
  });
});
