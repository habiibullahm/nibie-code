import { describe, expect, it } from "vitest";
import { assertPreviewDatabaseTarget } from "../../scripts/check-preview-db-target.mjs";

const previewRef = "abcdefghijklmnopqrst";
const productionRef = "zyxwvutsrqponmlkjihg";
const config = {
  PREVIEW_SUPABASE_PROJECT_REF: previewRef,
  PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
  PREVIEW_DATABASE_URL: `postgresql://postgres:synthetic-password@db.${previewRef}.supabase.co:5432/postgres`,
};

describe("isolated Preview migration target", () => {
  it("accepts only the configured project's direct or session-pooler connection", () => {
    expect(() => assertPreviewDatabaseTarget(config)).not.toThrow();
    expect(() => assertPreviewDatabaseTarget({
      ...config,
      PREVIEW_DATABASE_URL: `postgres://postgres.${previewRef}:synthetic-password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
    })).not.toThrow();
    expect(() => assertPreviewDatabaseTarget({
      ...config, PREVIEW_DATABASE_URL: config.PREVIEW_DATABASE_URL.replace(":5432", ""),
    })).not.toThrow();
  });

  it("refuses the production project, including when a shared pooler hostname is used", () => {
    for (const target of [
      `postgresql://postgres:synthetic-password@db.${productionRef}.supabase.co:5432/postgres`,
      `postgresql://postgres.${productionRef}:synthetic-password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
    ]) {
      expect(() => assertPreviewDatabaseTarget({ ...config, PREVIEW_DATABASE_URL: target })).toThrow(/configured Preview/);
    }
    expect(() => assertPreviewDatabaseTarget({ ...config, PREVIEW_SUPABASE_PROJECT_REF: productionRef })).toThrow(/different/);
  });

  it("requires explicit project identity and a Preview credential without falling back to production", () => {
    expect(() => assertPreviewDatabaseTarget({ ...config, PREVIEW_SUPABASE_PROJECT_REF: "" })).toThrow(/variables/);
    expect(() => assertPreviewDatabaseTarget({ ...config, PRODUCTION_SUPABASE_PROJECT_REF: "" })).toThrow(/variables/);
    expect(() => assertPreviewDatabaseTarget({ ...config, PREVIEW_SUPABASE_PROJECT_REF: "bad.ref" })).toThrow(/variables/);
    expect(() => assertPreviewDatabaseTarget({
      PREVIEW_SUPABASE_PROJECT_REF: previewRef, PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
      POSTGRES_URL_NON_POOLING: config.PREVIEW_DATABASE_URL,
    })).toThrow(/production fallback is forbidden/);
  });

  it("rejects transaction pooling, unexpected targets, and malformed URLs without disclosing them", () => {
    for (const target of [
      config.PREVIEW_DATABASE_URL.replace(":5432", ":6543"),
      config.PREVIEW_DATABASE_URL.replace(":5432", ":5433"),
      config.PREVIEW_DATABASE_URL.replace("postgresql:", "https:"),
      config.PREVIEW_DATABASE_URL.replace("/postgres", "/other"),
      config.PREVIEW_DATABASE_URL.replace(":synthetic-password", ""),
      config.PREVIEW_DATABASE_URL.replace(".supabase.co", ".supabase.co.example.com"),
      `postgresql://postgres.${previewRef}:synthetic-password@pooler.example.com:5432/postgres`,
      "malformed connection with synthetic-password",
    ]) {
      let message = "";
      try { assertPreviewDatabaseTarget({ ...config, PREVIEW_DATABASE_URL: target }); }
      catch (error) { message = (error as Error).message; }
      expect(message).not.toBe("");
      expect(message).not.toContain("synthetic-password");
      expect(message).not.toContain(target);
    }
  });
});
