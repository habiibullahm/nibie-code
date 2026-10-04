// A long High-style reply for streaming regressions: headings, lists, code fences, typographic quotes and multi-byte characters.
export const longReplyFixtureId = "fixture:long-high-reply";
export const longReplyEnd = "End of the Agent Foundation V1 outline.";

export const longReplyParts: string[] = [
  "# Agent Foundation V1 — the smallest useful version\n\n",
  ...Array.from({ length: 24 }, (_, index) => [
    `## ${index + 1}. Building block ${index + 1}\n\n`,
    `What it does: one narrow, testable capability with “clear” ownership — tradeoff ${index + 1} ✓. `,
    "Keep one tool, one loop and an explicit stop. ",
    "Defer memory, planning trees and multi-agent work.\n\n",
    `\`\`\`ts\nexport const step${index + 1} = (input: string) => input.trim();\n\`\`\`\n\n`,
  ]).flat(),
  "**Do not build yet:** autonomous background agents.\n\n",
  longReplyEnd,
];

export const longReply = longReplyParts.join("");
