import { describe, expect, it } from "vitest";
import { createReasoningStreamFilter, sanitizeModelOutput } from "../../lib/ai/sanitize-model-output";
import { toProviderMessages } from "../../lib/ai/provider-messages";
import { buildContext } from "../../lib/context/build-context";
import { defaultUserPreferences } from "../../lib/preferences/types";

function stream(chunks: string[]) {
  const filter = createReasoningStreamFilter();
  let text = "";
  const visible: string[] = [];
  for (const chunk of chunks) {
    const next = filter.push(chunk);
    visible.push(next);
    text += next;
  }
  const tail = filter.finish();
  return { text: text + tail, visible, tail, reasoningBlockCount: filter.reasoningBlockCount };
}

describe("model output sanitizer", () => {
  it("removes a single reasoning block", () => {
    expect(sanitizeModelOutput("<think>secret</think>Visible")).toEqual({ text: "Visible", reasoningBlockCount: 1 });
  });

  it("removes a multi-line reasoning block and keeps the answer", () => {
    const input = "<think>\nsecret reasoning\n</think>\n\n# Proposal";
    expect(sanitizeModelOutput(input).text).toBe("# Proposal");
  });

  it("removes every reasoning block and keeps the visible parts", () => {
    const input = "<think>first</think>\nvisible\n<think>second</think>\nfinal";
    expect(sanitizeModelOutput(input).text).toBe("visible\n\nfinal");
    expect(sanitizeModelOutput(input).reasoningBlockCount).toBe(2);
  });

  it("hides a reasoning tag that arrives split across chunks", () => {
    const result = stream(["<thi", "nk>secret", "</th", "ink>hello"]);
    expect(result.visible.join("")).not.toContain("secret");
    expect(result.visible.join("")).not.toContain("<thi");
    expect(result.text).toBe("hello");
    expect(result.reasoningBlockCount).toBe(1);
  });

  it("drops an unclosed reasoning block through the end of the stream", () => {
    const result = stream(["before", "<think>\n", "internal reasoning that never closes"]);
    expect(result.text).toBe("before");
    expect(result.text).not.toContain("internal");
    expect(result.reasoningBlockCount).toBe(1);
  });

  it("leaves ordinary text unchanged", () => {
    const input = "# Proposal\n\nA normal answer.";
    expect(sanitizeModelOutput(input)).toEqual({ text: input, reasoningBlockCount: 0 });
  });

  it("leaves the word think untouched when it is not a reasoning tag", () => {
    const input = "I think this plan is sound. Please think it through.";
    expect(sanitizeModelOutput(input).text).toBe(input);
    expect(sanitizeModelOutput("Use <thinking> as a label.").text).toBe("Use <thinking> as a label.");
  });

  it("strips reasoning from assistant history before the next model call", () => {
    const plan = buildContext({
      capabilities: { contextWindowTokens: 16_384, maxOutputTokens: 2_048 },
      preferences: defaultUserPreferences(),
      preferenceReadFailed: false,
      summary: null,
      currentPosition: 3,
      messages: [
        { role: "user", content: "I think we should draft this.", position: 1 },
        { role: "assistant", content: "<think>private reasoning</think>\n# Proposal", position: 2 },
        { role: "user", content: "Continue.", position: 3 },
      ],
    });
    const messages = toProviderMessages(plan);
    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("# Proposal");
    expect(JSON.stringify(messages)).not.toContain("private reasoning");
    expect(messages.find((message) => message.role === "user")?.content).toBe("I think we should draft this.");
  });
});
