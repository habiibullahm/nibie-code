import type {
  GitHubCommitSummary,
  GitHubIssueSummary,
  GitHubPullRequestSummary,
  GitHubRepoSummary,
  GitHubWorkflowRunSummary,
} from "@/lib/github/types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function preview(text: string | null, max = 280): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function firstLine(message: string | null, max = 200): string {
  if (!message) return "(no commit message)";
  const line = message.split("\n")[0]?.trim() || "(no commit message)";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function normalizeRepo(raw: unknown): GitHubRepoSummary | null {
  const r = asRecord(raw);
  if (!r) return null;
  const owner = asRecord(r.owner);
  const ownerLogin = str(owner?.login);
  const name = str(r.name);
  const fullName = str(r.full_name) ?? (ownerLogin && name ? `${ownerLogin}/${name}` : null);
  const htmlUrl = str(r.html_url);
  if (!fullName || !name || !ownerLogin || !htmlUrl) return null;
  return {
    fullName,
    owner: ownerLogin,
    name,
    description: str(r.description),
    defaultBranch: str(r.default_branch) ?? "main",
    private: bool(r.private),
    htmlUrl,
    language: str(r.language),
    stargazersCount: num(r.stargazers_count) ?? 0,
    forksCount: num(r.forks_count) ?? 0,
    openIssuesCount: num(r.open_issues_count) ?? 0,
    pushedAt: str(r.pushed_at),
    updatedAt: str(r.updated_at),
  };
}

export function normalizeCommit(raw: unknown): GitHubCommitSummary | null {
  const r = asRecord(raw);
  if (!r) return null;
  const sha = str(r.sha);
  const htmlUrl = str(r.html_url);
  if (!sha || !htmlUrl) return null;
  const commit = asRecord(r.commit);
  const authorObj = asRecord(commit?.author);
  const committerObj = asRecord(commit?.committer);
  const authorUser = asRecord(r.author);
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: firstLine(str(commit?.message)),
    authorLogin: str(authorUser?.login),
    authorName: str(authorObj?.name) ?? str(committerObj?.name),
    committedAt: str(authorObj?.date) ?? str(committerObj?.date),
    htmlUrl,
  };
}

export function normalizePullRequest(raw: unknown): GitHubPullRequestSummary | null {
  const r = asRecord(raw);
  if (!r) return null;
  const number = num(r.number);
  const title = str(r.title);
  const htmlUrl = str(r.html_url);
  if (number == null || !title || !htmlUrl) return null;
  const user = asRecord(r.user);
  const base = asRecord(r.base);
  const head = asRecord(r.head);
  return {
    number,
    title,
    state: str(r.state) ?? "unknown",
    draft: bool(r.draft),
    // List payloads often omit `merged` but include `merged_at` when merged.
    merged: bool(r.merged) || Boolean(str(r.merged_at)),
    htmlUrl,
    authorLogin: str(user?.login),
    baseRef: str(base?.ref),
    headRef: str(head?.ref),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    mergedAt: str(r.merged_at),
    bodyPreview: preview(str(r.body)),
  };
}

/** Issues API includes pull requests — filter those out for honest issue lists. */
export function isPullRequestIssue(raw: unknown): boolean {
  const r = asRecord(raw);
  return Boolean(r && "pull_request" in r && r.pull_request != null);
}

export function normalizeIssue(raw: unknown): GitHubIssueSummary | null {
  const r = asRecord(raw);
  if (!r || isPullRequestIssue(r)) return null;
  const number = num(r.number);
  const title = str(r.title);
  const htmlUrl = str(r.html_url);
  if (number == null || !title || !htmlUrl) return null;
  const user = asRecord(r.user);
  const labelsRaw = Array.isArray(r.labels) ? r.labels : [];
  const labels = labelsRaw
    .map((label) => {
      if (typeof label === "string") return label;
      const rec = asRecord(label);
      return str(rec?.name);
    })
    .filter((name): name is string => Boolean(name))
    .slice(0, 20);
  return {
    number,
    title,
    state: str(r.state) ?? "unknown",
    htmlUrl,
    authorLogin: str(user?.login),
    labels,
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    bodyPreview: preview(str(r.body)),
  };
}

export function normalizeWorkflowRun(raw: unknown): GitHubWorkflowRunSummary | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = num(r.id);
  const htmlUrl = str(r.html_url);
  if (id == null || !htmlUrl) return null;
  return {
    id,
    name: str(r.name),
    displayTitle: str(r.display_title),
    status: str(r.status),
    conclusion: str(r.conclusion),
    event: str(r.event),
    headBranch: str(r.head_branch),
    headSha: str(r.head_sha)?.slice(0, 40) ?? null,
    htmlUrl,
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}
