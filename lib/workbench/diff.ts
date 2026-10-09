export type WorkbenchDiffLine = {
  kind: "same" | "removed" | "added";
  text: string;
};

/** Simple line-oriented comparison for review UI (not a full Myers diff). */
export function workbenchLineDiff(original: string, suggested: string): WorkbenchDiffLine[] {
  const left = original.split("\n");
  const right = suggested.split("\n");
  const rows: WorkbenchDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      rows.push({ kind: "same", text: left[i]! });
      i += 1;
      j += 1;
      continue;
    }
    const leftNext = j < right.length ? left.indexOf(right[j]!, i) : -1;
    const rightNext = i < left.length ? right.indexOf(left[i]!, j) : -1;
    if (leftNext !== -1 && (rightNext === -1 || leftNext - i <= rightNext - j)) {
      while (i < leftNext) {
        rows.push({ kind: "removed", text: left[i]! });
        i += 1;
      }
      continue;
    }
    if (rightNext !== -1) {
      while (j < rightNext) {
        rows.push({ kind: "added", text: right[j]! });
        j += 1;
      }
      continue;
    }
    if (i < left.length) {
      rows.push({ kind: "removed", text: left[i]! });
      i += 1;
    }
    if (j < right.length) {
      rows.push({ kind: "added", text: right[j]! });
      j += 1;
    }
  }
  return rows;
}
