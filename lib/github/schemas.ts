import { z } from "zod";

/**
 * GitHub owner (user or org) login — bounded, no path traversal.
 * @see https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/iam-configuration-reference/username-considerations-for-external-authentication
 */
export const githubOwnerSchema = z
  .string()
  .trim()
  .min(1)
  .max(39)
  .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/, "Invalid GitHub owner");

/** Repository name segment — no slashes. */
export const githubRepoSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, "Invalid GitHub repository name")
  .refine((value) => !value.includes(".."), "Invalid GitHub repository name");

export const githubRepoRefSchema = z.strictObject({
  owner: githubOwnerSchema,
  repo: githubRepoSchema,
});

/** Bounded list page size for V1 Read Actions. */
export function githubPerPageSchema(max: number, fallback: number) {
  return z.coerce.number().int().min(1).max(max).default(fallback);
}

export const githubIssueStateSchema = z.enum(["open", "closed", "all"]).default("open");
export const githubPullStateSchema = z.enum(["open", "closed", "all"]).default("open");

export const githubPullNumberSchema = z.coerce.number().int().positive().max(1_000_000);

/** Optional git ref / SHA for commits.list — no whitespace or path tricks. */
export const githubShaOrRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._\-/]+$/, "Invalid ref")
  .refine((value) => !value.includes(".."), "Invalid ref")
  .optional();
