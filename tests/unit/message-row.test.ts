import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageRow } from "../../components/message-row";
import type { PersistedMessage } from "../../lib/chat/read";

const noop = () => {};
const render = (message: Partial<PersistedMessage>) => renderToStaticMarkup(createElement(MessageRow, {
  message: { id: "m1", role: "assistant", content: "", position: 2, status: "complete", ...message } as PersistedMessage,
  initial: "M", isLast: true, isLastUser: false, canMutate: true, disabled: false, editing: false,
  onRegenerate: noop, onStartEdit: noop, onCancelEdit: noop, onSaveEdit: noop,
}));

describe("assistant MessageRow", () => {
  it("shows only the animated mark while Nibie is thinking", () => {
    const html = render({ status: "streaming", content: "" });
    expect(html).toContain('class="response-thinking"');
    expect(html).toContain('data-activity="thinking"');
    expect(html).toContain('role="status">Nibie is responding<');
    expect(html).not.toContain("message-author");
    expect(html).not.toMatch(/>Nibie</);
  });

  it("drops the mark once text streams in and uses the caret instead", () => {
    const html = render({ status: "streaming", content: "Partial answer" });
    expect(html).not.toContain("brand-mark");
    expect(html).toContain("markdown has-caret");
    expect(html).toContain('role="status">Nibie is responding<');
  });

  it("renders a completed reply as text only, with no author header", () => {
    const html = render({ status: "complete", content: "Done." });
    expect(html).not.toContain("brand-mark");
    expect(html).not.toContain("message-author");
    expect(html).not.toContain('role="status"');
  });

  it("keeps the Stopped and error labels without the Nibie name", () => {
    expect(render({ status: "interrupted", content: "Half" })).toMatch(/<div class="message-author"><span class="message-status">Stopped<\/span><\/div>/);
    expect(render({ status: "error", content: "" })).toContain('<span class="message-status is-danger">Couldn&#x27;t respond</span>');
  });
});
