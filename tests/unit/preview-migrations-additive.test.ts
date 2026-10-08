import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHARED_DB_MIGRATE_LABEL,
  checkAdditiveMigrations,
  findForbiddenPatterns,
} from "../../scripts/check-preview-migrations-additive.mjs";

describe("preview shared-DB migration additive gate", () => {
  it("exports the explicit-approval label used by Preview App DB Migration", () => {
    expect(SHARED_DB_MIGRATE_LABEL).toBe("allow-shared-db-migrate");
  });

  it("accepts additive create/alter patterns", () => {
    const sql = `
      CREATE TABLE "widgets" ("id" uuid PRIMARY KEY);
      ALTER TABLE "widgets" ADD COLUMN "name" text;
      CREATE OR REPLACE FUNCTION public.touch_widget() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;
    `;
    expect(findForbiddenPatterns(sql)).toEqual([]);
  });

  it("flags destructive patterns that must not hit the shared app DB from PR CI", () => {
    expect(findForbiddenPatterns("DROP TABLE public.widgets;")).toContain("DROP TABLE");
    expect(findForbiddenPatterns("ALTER TABLE t DROP COLUMN x;")).toContain("DROP COLUMN");
    expect(findForbiddenPatterns("TRUNCATE public.widgets;")).toContain("TRUNCATE");
    expect(findForbiddenPatterns("DELETE FROM public.widgets WHERE true;")).toContain("DELETE FROM");
    expect(findForbiddenPatterns("DROP SCHEMA public CASCADE;")).toContain("DROP SCHEMA");
    expect(findForbiddenPatterns("ALTER TYPE weekly_usage_mode DROP VALUE 'x';")).toContain("ALTER TYPE … DROP");
  });

  it("reports problems only for the provided changed SQL names", () => {
    const root = mkdtempSync(join(tmpdir(), "preview-mig-"));
    const drizzleDir = join(root, "drizzle");
    mkdirSync(drizzleDir);
    writeFileSync(join(drizzleDir, "0099_safe.sql"), "CREATE TABLE safe (id uuid PRIMARY KEY);\n");
    writeFileSync(join(drizzleDir, "0100_bad.sql"), "DELETE FROM public.safe;\n");

    const ok = checkAdditiveMigrations(root, { changedNames: ["0099_safe.sql"] });
    expect(ok.problems).toEqual([]);
    expect(ok.comparedToMain).toBe(true);

    const bad = checkAdditiveMigrations(root, { changedNames: ["0100_bad.sql"] });
    expect(bad.problems).toEqual(["0100_bad.sql: forbidden pattern DELETE FROM"]);
  });
});
