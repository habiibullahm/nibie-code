import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { highlightCode } from "../../lib/markdown/highlight";

const render = (code: string, language: string | undefined) => {
  const node = highlightCode(code, language);
  return node === null ? null : renderToStaticMarkup(createElement("code", null, node));
};

describe("highlightCode", () => {
  it("marks shell commands and flags on every line, not only shell built-ins", () => {
    const html = render("python --version\ngit --version", "bash");
    expect(html).toContain('<span class="hljs-built_in">python</span> <span class="hljs-attr">--version</span>');
    expect(html).toContain('<span class="hljs-built_in">git</span> <span class="hljs-attr">--version</span>');
  });

  it("keeps shell control words as keywords and colors commands after a pipe", () => {
    const html = render('if [ -f x ]; then echo "hi" | grep -i h; fi', "sh");
    expect(html).toContain('<span class="hljs-keyword">if</span>');
    expect(html).toContain('<span class="hljs-keyword">then</span>');
    expect(html).toContain('<span class="hljs-built_in">grep</span>');
  });

  it("resolves common aliases case-insensitively", () => {
    for (const language of ["TS", "js", "py", "yml", "html", "zsh", "console"]) {
      expect(render("x", language), language).not.toBeNull();
    }
  });

  it("returns null for missing or unknown languages so the caller renders plain text", () => {
    expect(highlightCode("x", undefined)).toBeNull();
    expect(highlightCode("x", "not-a-language")).toBeNull();
  });

  it("renders model-written markup as escaped text, never as HTML", () => {
    const html = render('const a = "<img src=x onerror=alert(1)>";\n<script>alert(2)</script>', "ts");
    expect(html).not.toMatch(/<img|<script/i);
    const text = html?.replace(/<\/?(?:code|span)[^>]*>/g, "");
    expect(text).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(text).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("preserves the exact source text", () => {
    const code = 'def f(x):\n    return {"a": [1, 2.5, None]}  # done\n';
    const node = highlightCode(code, "python");
    const text = renderToStaticMarkup(createElement("code", null, node)).replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    expect(text).toBe(code);
  });
});
