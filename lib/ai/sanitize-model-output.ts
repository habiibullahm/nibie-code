// Removes model-internal reasoning markers such as <think> from assistant text.
// Historical database rows are not rewritten. Read, export, and Workbench handoff
// call this before showing or copying stored assistant text. A one-time cleanup
// of older rows can be a separate migration.

const THINK = "think";

export type SanitizedModelOutput = {
  text: string;
  reasoningBlockCount: number;
};

type TagScan = number | "prefix" | null;

function isSpace(char: string) {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

// `closing` selects </think>. A returned number is the tag length. "prefix" means
// the fragment could still become that tag when more characters arrive.
function tagLength(fragment: string, closing: boolean): TagScan {
  let index = 0;
  if (fragment[index] !== "<") return null;
  index += 1;
  if (index >= fragment.length) return "prefix";
  while (index < fragment.length && isSpace(fragment[index]!)) index += 1;
  if (index >= fragment.length) return "prefix";
  if (closing) {
    if (fragment[index] !== "/") return null;
    index += 1;
    if (index >= fragment.length) return "prefix";
    while (index < fragment.length && isSpace(fragment[index]!)) index += 1;
    if (index >= fragment.length) return "prefix";
  } else if (fragment[index] === "/") {
    return null;
  }
  const word = fragment.slice(index, index + THINK.length);
  if (word.length < THINK.length) return THINK.startsWith(word.toLowerCase()) ? "prefix" : null;
  if (word.toLowerCase() !== THINK) return null;
  index += THINK.length;
  if (index >= fragment.length) return "prefix";
  while (index < fragment.length && isSpace(fragment[index]!)) index += 1;
  if (index >= fragment.length) return "prefix";
  if (fragment[index] !== ">") return null;
  return index + 1;
}

function incompleteThinkPrefix(fragment: string) {
  if (!fragment || tagLength(fragment, false) !== "prefix") return false;
  const word = fragment.replace(/^<\s*/, "").trim().toLowerCase();
  return word.length > 0 && THINK.startsWith(word);
}

function consume(buffer: string, depth: number): { visible: string; rest: string; depth: number; opened: number } {
  let visible = "";
  let index = 0;
  let opened = 0;
  while (index < buffer.length) {
    const start = buffer.indexOf("<", index);
    if (start === -1) {
      if (depth === 0) visible += buffer.slice(index);
      return { visible, rest: "", depth, opened };
    }
    if (depth === 0) visible += buffer.slice(index, start);
    const fragment = buffer.slice(start);
    if (depth === 0) {
      const open = tagLength(fragment, false);
      if (typeof open === "number") {
        depth += 1;
        opened += 1;
        index = start + open;
        continue;
      }
      if (open === "prefix") return { visible, rest: fragment, depth, opened };
      visible += "<";
      index = start + 1;
      continue;
    }
    const open = tagLength(fragment, false);
    const close = tagLength(fragment, true);
    if (typeof open === "number" && (typeof close !== "number" || open <= close)) {
      depth += 1;
      opened += 1;
      index = start + open;
      continue;
    }
    if (typeof close === "number") {
      depth -= 1;
      index = start + close;
      continue;
    }
    if (open === "prefix" || close === "prefix") return { visible, rest: fragment, depth, opened };
    index = start + 1;
  }
  return { visible, rest: "", depth, opened };
}

export function createReasoningStreamFilter() {
  let depth = 0;
  let pending = "";
  let reasoningBlockCount = 0;
  let started = false;
  let finished = false;

  const reveal = (text: string) => {
    if (!text) return "";
    if (started || reasoningBlockCount === 0) {
      started = true;
      return text;
    }
    const stripped = text.replace(/^\s+/, "");
    if (!stripped) return "";
    started = true;
    return stripped;
  };

  return {
    push(chunk: string) {
      if (finished || !chunk) return "";
      const scanned = consume(pending + chunk, depth);
      pending = scanned.rest;
      depth = scanned.depth;
      reasoningBlockCount += scanned.opened;
      return reveal(scanned.visible);
    },
    finish() {
      if (finished) return "";
      finished = true;
      if (depth > 0) {
        pending = "";
        return "";
      }
      const rest = pending;
      pending = "";
      if (incompleteThinkPrefix(rest)) return "";
      return reveal(rest);
    },
    get reasoningBlockCount() {
      return reasoningBlockCount;
    },
  };
}

export function sanitizeModelOutput(input: string): SanitizedModelOutput {
  const filter = createReasoningStreamFilter();
  const text = `${filter.push(input)}${filter.finish()}`;
  return { text, reasoningBlockCount: filter.reasoningBlockCount };
}
