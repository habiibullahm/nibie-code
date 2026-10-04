import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const directory = join(process.cwd(), "drizzle");
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();

// The migrator splits on the breakpoint marker, but psql and the Supabase SQL editor read "--" as a comment to the end
// of the line. A statement glued after a marker would run under one tool and be silently skipped under the other.
describe.each(files)("migration %s", (name) => {
  it("ends every breakpoint marker at the end of its line", () => {
    const glued = readFileSync(join(directory, name), "utf8").split("\n").filter((line) => /--> statement-breakpoint\s*\S/.test(line));
    expect(glued).toEqual([]);
  });
});

// drizzle-orm's migrator applies only entries whose journal "when" is later than the newest row in
// __drizzle_migrations. An entry dated earlier than one already applied is skipped silently on a hosted database,
// while a fresh database runs it, so local tests can't catch it.
describe("migration journal", () => {
  it("dates every entry later than the one before it", () => {
    const { entries } = JSON.parse(readFileSync(join(directory, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const outOfOrder = entries.filter((entry, index) => index > 0 && entry.when <= entries[index - 1].when).map((entry) => entry.tag);
    expect(outOfOrder).toEqual([]);
  });
});
