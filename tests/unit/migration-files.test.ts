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
