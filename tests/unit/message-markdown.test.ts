import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageMarkdown } from "../../components/message-markdown";

const render = (content: string) => renderToStaticMarkup(createElement(MessageMarkdown, { content }));

describe("MessageMarkdown", () => {
  it("never renders raw HTML from model output", () => {
    const html = render('<script>alert(1)</script><img src=x onerror="alert(2)"><iframe src="https://evil.test"></iframe>\n\nvisible text');
    expect(html).not.toMatch(/<script|<iframe|<img|onerror/i);
    expect(html).toContain("visible text");
  });

  it("drops links with unsafe or obfuscated protocols and keeps their text", () => {
    for (const target of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:x", "java&#115;cript:alert(1)", "/relative/path"]) {
      const html = render(`[click me](${target})`);
      expect(html).not.toContain("href=");
      expect(html).toContain("click me");
    }
  });

  it("opens allowed links in a new tab without leaking the opener", () => {
    const html = render("[docs](https://example.com/page) and [mail](mailto:hi@example.com)");
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('href="mailto:hi@example.com"');
    expect(html.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(2);
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
  });

  it("does not load remote images and shows their alt text instead", () => {
    const html = render("![tracking pixel](https://evil.test/p.png?u=secret)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.test");
    expect(html).toContain("tracking pixel");
  });

  it("renders fenced code with its language, an accessible copy control, and escaped content", () => {
    const html = render('```ts\nconst a = "<b>x</b>";\n```');
    expect(html).toContain("code-block");
    expect(html).toContain(">ts<");
    expect(html).toContain('aria-label="Copy ts code block"');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("renders common Markdown structure", () => {
    const html = render("# Title\n\n- one\n- two\n\n**bold** and `inline`\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain("markdown-table");
  });

  it("keeps an unterminated code fence readable while streaming", () => {
    const html = render("Here you go:\n\n```py\nprint('partial')");
    expect(html).toContain("code-block");
    expect(html).toContain("print(&#x27;partial&#x27;)");
  });

  it("renders known citation markers as in-page links and leaves unknown numbers plain", () => {
    const html = renderToStaticMarkup(createElement(MessageMarkdown, {
      content: "Node 22 is current [1] and not [2].",
      sources: [{ ordinal: 1, kind: "web", title: "Node.js", url: "https://nodejs.org/en", domain: "nodejs.org" }],
    }));
    expect(html).toContain('href="#citation-source-1"');
    expect(html).toContain("citation-marker");
    expect(html).toContain("[1]");
    expect(html).toContain("[2]");
    expect(html).not.toContain("#citation-source-2");
  });
});
