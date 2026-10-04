import { untitledWorkbenchTitle, workbenchTitleLimit } from "@/lib/workbench/types";

// First non-empty line, with a leading markdown heading mark removed. No model call.
export function workbenchTitleFromContent(content: string): string {
  const first = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const withoutHeading = first.replace(/^#{1,6}\s+/, "");
  const plain = withoutHeading.replace(/[*_`]/g, "").replace(/\s+/g, " ").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const clipped = Array.from(plain).slice(0, workbenchTitleLimit).join("").trim();
  return clipped.length > 0 ? clipped : untitledWorkbenchTitle;
}
