import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageMarkdown } from "../../components/message-markdown";
import { formattingSample } from "../fixtures/formatting-sample";

const render = (content: string) => renderToStaticMarkup(createElement(MessageMarkdown, { content }));
const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;

// Representative answers in the shape the response policy asks for, rendered through the real renderer.
const examples = {
  simpleFact: "The capital of Japan is Tokyo. It has been the seat of government since 1869.",
  procedure: "1. Install Python 3 with `brew install python`.\n2. Create the environment with `python3 -m venv .venv`.\n3. Activate it with `source .venv/bin/activate`.",
  technical: "HTTP caching lets a browser reuse a response.\n\n## Freshness\n\n`Cache-Control: max-age` says how long a copy stays fresh.\n\n## Validation\n\nAn `ETag` lets the server confirm a stale copy is still valid.",
  comparison: "SQLite is enough to start; PostgreSQL scales further.\n\n| | Concurrency | Operations |\n| --- | --- | --- |\n| PostgreSQL | High | Moderate |\n| SQLite | Single writer | Minimal |",
  coding: "```ts\nexport function groupBy<T>(items: T[], key: keyof T) {\n  return items.reduce<Record<string, T[]>>((groups, item) => {\n    (groups[String(item[key])] ??= []).push(item);\n    return groups;\n  }, {});\n}\n```\n\n`groupBy` keys each item by `item[key]`.",
  longStructured: "Welcome to the team.\n\n## First week\n\n### Day one\n\n1. Get repository access.\n2. Run the app locally.\n\n### Day two\n\n- Read the architecture notes.\n- Pair on a small fix.\n\n## First month\n\nOwn one feature end to end.",
  veryShort: "You're welcome!",
  // Indonesian Natural Structured Markdown shapes (Issue #90).
  idSimpleFact: "Ibu kota Jepang adalah Tokyo. Kota itu menjadi pusat pemerintahan sejak 1869.",
  idHowto: "1. Pasang Python 3 dengan `brew install python`.\n2. Buat environment dengan `python3 -m venv .venv`.\n3. Aktifkan dengan `source .venv/bin/activate`.",
  idRagDesign: "RAG untuk FAQ klinik memisahkan indexing, retrieval, dan grounding.\n\n## Indexing\n\nChunk dokumen FAQ dan simpan embedding per chunk.\n\n## Retrieval\n\nAmbil top-k chunk relevan ke pertanyaan user.\n\n### Grounding\n\nJawab hanya dari chunk yang diambil; sebutkan ketidakpastian bila sumber tidak cukup.",
  idComparison: "PostgreSQL lebih cocok untuk concurrency; SQLite cukup untuk prototipe.\n\n| | Concurrency | Operasi |\n| --- | --- | --- |\n| PostgreSQL | Tinggi | Sedang |\n| SQLite | Single writer | Minimal |",
  plainTextOnly: "A Room in Nibie is shared project context that threads can reuse.",
  codeOnly: "```ts\nexport const add = (a: number, b: number) => a + b;\n```",
  citationsNearClaim: "HTTP caching reduces repeat downloads [1].\n\nStale copies can revalidate with an `ETag` [2].",
};

describe("assistant formatting examples", () => {
  it("A. a simple factual answer is short paragraphs with no structure", () => {
    const html = render(examples.simpleFact);
    expect(count(html, "p")).toBe(1);
    for (const tag of ["h1", "h2", "h3", "ul", "ol", "table"]) expect(count(html, tag)).toBe(0);
  });

  it("B. a procedure is a numbered list with inline commands", () => {
    const html = render(examples.procedure);
    expect(count(html, "ol")).toBe(1);
    expect(count(html, "li")).toBe(3);
    expect(html).toContain("<code>python3 -m venv .venv</code>");
  });

  it("C. a technical explanation is an intro plus compact sections", () => {
    const html = render(examples.technical);
    expect(html.indexOf("<p>")).toBeLessThan(html.indexOf("<h2>"));
    expect(count(html, "h2")).toBe(2);
    expect(count(html, "h1")).toBe(0);
  });

  it("D. a comparison renders as a scrollable table", () => {
    const html = render(examples.comparison);
    expect(html).toContain('<div class="markdown-table"><table>');
    expect(count(html, "th")).toBe(3);
  });

  it("E. a coding answer is a labelled fenced block with copy, then inline references", () => {
    const html = render(examples.coding);
    expect(html).toContain('<div class="code-block-header"><span>ts</span>');
    expect(html).toContain('aria-label="Copy ts code block"');
    expect(html).toContain("<code>groupBy</code>");
  });

  it("every fenced code block has labelled Copy and Wrap controls, with or without a language", () => {
    const html = render("```bash\nnpm run build\n```\n\n```\nplain text block\n```");
    expect((html.match(/copy-button is-compact/g) ?? []).length).toBe(4);
    expect(html).toContain('aria-label="Copy bash code block"');
    expect(html).toContain('aria-label="Copy code block"');
    expect((html.match(/aria-label="Wrap code"/g) ?? []).length).toBe(2);
    expect((html.match(/lucide-copy/g) ?? []).length).toBe(2);
    expect((html.match(/lucide-wrap-text/g) ?? []).length).toBe(2);
    expect(html).toMatch(/>Copy</);
    expect(html).toMatch(/>Wrap</);
    expect(html).toContain('<div class="code-block-header"><span>text</span>');
  });

  it("F. a long structured answer uses an H2/H3 hierarchy without H1", () => {
    const html = render(examples.longStructured);
    expect(count(html, "h1")).toBe(0);
    expect(count(html, "h2")).toBe(2);
    expect(count(html, "h3")).toBe(2);
    expect(count(html, "ol")).toBe(1);
    expect(count(html, "ul")).toBe(1);
  });

  it("G. a very short answer has no Markdown structure", () => {
    expect(render(examples.veryShort)).toBe('<div class="markdown"><p>You&#x27;re welcome!</p></div>');
  });

  it("H. Indonesian simple facts stay short paragraphs without structure", () => {
    const html = render(examples.idSimpleFact);
    expect(count(html, "p")).toBe(1);
    for (const tag of ["h1", "h2", "h3", "ul", "ol", "table"]) expect(count(html, tag)).toBe(0);
    expect(html).toContain("Tokyo");
  });

  it("I. Indonesian how-tos use numbered steps and inline commands", () => {
    const html = render(examples.idHowto);
    expect(count(html, "ol")).toBe(1);
    expect(count(html, "li")).toBe(3);
    expect(html).toContain("<code>python3 -m venv .venv</code>");
  });

  it("J. Indonesian multi-section explanations use ##/### without H1", () => {
    const html = render(examples.idRagDesign);
    expect(html.indexOf("<p>")).toBeLessThan(html.indexOf("<h2>"));
    expect(count(html, "h2")).toBe(2);
    expect(count(html, "h3")).toBe(1);
    expect(count(html, "h1")).toBe(0);
  });

  it("K. Indonesian comparisons render scrollable tables", () => {
    const html = render(examples.idComparison);
    expect(html).toContain('<div class="markdown-table"><table>');
    expect(html).toContain("PostgreSQL");
  });

  it("L. plain-text-only replies stay a single paragraph", () => {
    const html = render(examples.plainTextOnly);
    expect(count(html, "p")).toBe(1);
    for (const tag of ["h1", "h2", "h3", "ul", "ol", "table", "pre"]) expect(count(html, tag)).toBe(0);
  });

  it("M. code-only replies are a labelled fence without prose wrappers", () => {
    const html = render(examples.codeOnly);
    expect(html).toContain('<div class="code-block-header"><span>ts</span>');
    expect(count(html, "p")).toBe(0);
  });

  it("N. citation markers near claims stay linkable and safe", () => {
    const html = renderToStaticMarkup(createElement(MessageMarkdown, {
      content: examples.citationsNearClaim,
      sources: [
        { ordinal: 1, kind: "web", title: "MDN Caching", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching", domain: "developer.mozilla.org" },
        { ordinal: 2, kind: "web", title: "ETag", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag", domain: "developer.mozilla.org" },
      ],
    }));
    expect(html).toContain('href="#citation-source-1"');
    expect(html).toContain('href="#citation-source-2"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });
});

describe("streaming partial Markdown", () => {
  it("renders every prefix of a long reply without dropping text that has arrived", () => {
    // The renderer runs on each streamed flush: partial lists, fences, tables and emphasis must never throw or vanish.
    for (let end = 1; end <= formattingSample.length; end += 23) {
      const prefix = formattingSample.slice(0, end);
      const html = render(prefix);
      const lastWord = prefix.trim().split(/\s+/).pop()!.replace(/[^A-Za-z0-9]/g, "");
      const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;|&quot;|&amp;|&lt;|&gt;/g, "").replace(/[^A-Za-z0-9]/g, "");
      if (lastWord.length > 3) expect(text).toContain(lastWord.slice(0, 3));
    }
  });

  it("keeps partial structures readable", () => {
    expect(render("Steps:\n\n1. First\n2. Sec")).toContain("<li>Sec</li>");
    expect(render("| Name | Value |\n| --- | --- |\n| a")).toContain("<table>");
    // A table header without its delimiter row is still plain text, not lost.
    expect(render("| Name | Value |")).toContain("| Name | Value |");
    // An unfinished emphasis marker stays visible as text until it closes.
    expect(render("This is **important")).toContain("**important");
    expect(render("```bash\nnpm run bu")).toContain("npm run bu");
  });
});
