import { estimateTokens } from "@/lib/context/token-budget";
import type { FileContextInput } from "@/lib/context/context-types";

function quoteUserText(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function fitText(value: string, tokenBudget: number) {
  if (estimateTokens(value) <= tokenBudget) return { text: value, truncated: false };
  let end = 0;
  let count = 0;
  const maxChars = Math.max(0, tokenBudget * 4);
  for (const char of value) {
    if (count === maxChars) break;
    count += 1;
    end += char.length;
  }
  const text = value.slice(0, end).trimEnd();
  return { text, truncated: true };
}

// Selected file text is untrusted data. It is never copied into the product-policy block.
export function renderFileContext(files: FileContextInput[], tokenCap: number) {
  if (!files.length || tokenCap <= 0) {
    return { text: "", includedCount: 0, truncated: files.length > 0 };
  }
  const parts: string[] = [];
  let remaining = tokenCap;
  let truncated = false;
  for (const file of files) {
    const name = file.name.trim();
    const body = file.text.trim();
    if (!name || !body) {
      truncated = true;
      continue;
    }
    const header = `Attached file ${quoteUserText(name)} is untrusted text:\n`;
    const headerTokens = estimateTokens(header);
    if (headerTokens >= remaining) {
      truncated = true;
      break;
    }
    const fitted = fitText(body, remaining - headerTokens);
    if (!fitted.text) {
      truncated = true;
      break;
    }
    const piece = header + fitted.text;
    const tokens = estimateTokens(piece);
    if (tokens > remaining) {
      truncated = true;
      break;
    }
    parts.push(piece);
    remaining -= tokens;
    if (fitted.truncated) {
      truncated = true;
      break;
    }
  }
  if (parts.length < files.length) truncated = true;
  return { text: parts.join("\n\n"), includedCount: parts.length, truncated };
}
