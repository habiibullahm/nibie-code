import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageRow } from "../../components/message-row";
import type { PersistedMessage } from "../../lib/chat/read";

const noop = () => {};
const render = (message: Partial<PersistedMessage>, waitLabel?: string, highlighted = false) => renderToStaticMarkup(createElement(MessageRow, {
  waitLabel,
  highlighted,
  message: { id: "m1", role: "assistant", content: "", position: 2, status: "complete", ...message } as PersistedMessage,
  initial: "M", isLast: true, isLastUser: false, canMutate: true, disabled: false, editing: false,
  onRegenerate: noop, onStartEdit: noop, onCancelEdit: noop, onSaveEdit: noop,
}));

describe("assistant MessageRow", () => {
  it("shows only a status label before the first token, defaulting to Responding…", () => {
    const html = render({ status: "streaming", content: "" });
    expect(html).toContain('<span class="response-thinking" aria-hidden="true">Responding…</span>');
    expect(html).not.toContain("brand-mark");
    expect(html).toContain('role="status">Nibie is responding<');
    expect(html).not.toContain("message-author");
    expect(html).not.toMatch(/>Nibie</);
  });

  it("labels the wait by mode: Thinking… for High, Researching… for Deep Research", () => {
    expect(render({ status: "streaming", content: "" }, "Thinking…")).toContain('aria-hidden="true">Thinking…</span>');
    expect(render({ status: "streaming", content: "" }, "Responding…")).toContain('aria-hidden="true">Responding…</span>');
    expect(render({ status: "streaming", content: "", researchStage: "searching" }, "Thinking…")).toContain('aria-hidden="true">Researching…</span>');
  });

  it("removes the indicator as soon as text arrives and renders it without any streaming decoration", () => {
    const html = render({ status: "streaming", content: "Partial answer" });
    expect(html).not.toContain("response-thinking");
    expect(html).not.toContain("brand-mark");
    expect(html).toContain('<div class="markdown"><p>Partial answer</p></div>');
    expect(html).toContain('role="status">Nibie is responding<');
  });

  it("renders a completed reply as text only, with no author header", () => {
    const html = render({ status: "complete", content: "Done." });
    expect(html).not.toContain("response-thinking");
    expect(html).not.toContain("message-author");
    expect(html).not.toContain('role="status"');
  });

  it("keeps assistant message actions icon-only with accessible names", () => {
    const html = render({ status: "complete", content: "Done." });
    expect(html).toContain('class="response-copy is-icon-only"');
    expect(html).toContain('aria-label="Copy response"');
    expect(html).toContain('aria-label="Regenerate"');
    expect(html).toContain('class="message-action is-icon-only"');
    expect(html).not.toMatch(/<span>Regenerate<\/span>/);
    expect(html).not.toMatch(/aria-live="polite">Copy<\/span>/);
  });

  it("exposes a stable message anchor and optional search highlight", () => {
    const html = render({ status: "complete", content: "Done." }, undefined, true);
    expect(html).toContain('data-message-id="m1"');
    expect(html).toContain('id="message-m1"');
    expect(html).toContain("is-search-highlight");
  });

  it("keeps the Stopped and error labels without the Nibie name", () => {
    expect(render({ status: "interrupted", content: "Half" })).toMatch(/<div class="message-author"><span class="message-status">Stopped<\/span><\/div>/);
    expect(render({ status: "error", content: "" })).toContain('<span class="message-status is-danger">Couldn&#x27;t respond</span>');
  });
});
