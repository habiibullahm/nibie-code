import "server-only";

/** Honest failure categories for GitHub Read Actions — never invent success. */
export type GitHubFailureCategory =
  | "not_found"
  | "forbidden"
  | "unauthorized"
  | "rate_limited"
  | "validation"
  | "timeout"
  | "aborted"
  | "network"
  | "http_status"
  | "parse_error"
  | "unconfigured";

export class GitHubApiError extends Error {
  readonly category: GitHubFailureCategory;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    category: GitHubFailureCategory,
    message: string,
    options?: { status?: number; retryAfterSeconds?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GitHubApiError";
    this.category = category;
    this.status = options?.status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export function userFacingGitHubError(error: GitHubApiError): string {
  switch (error.category) {
    case "not_found":
      return "That GitHub repository or resource was not found (or is private).";
    case "forbidden":
      return "GitHub refused access to that resource.";
    case "unauthorized":
      return "GitHub authentication failed. Check the server token configuration.";
    case "rate_limited":
      return error.retryAfterSeconds
        ? `GitHub rate limit reached. Try again in about ${error.retryAfterSeconds}s.`
        : "GitHub rate limit reached. Try again shortly.";
    case "validation":
      return "GitHub rejected the request as invalid.";
    case "timeout":
      return "GitHub request timed out.";
    case "aborted":
      return "GitHub request was cancelled.";
    case "network":
      return "Could not reach GitHub.";
    case "parse_error":
      return "GitHub returned an unexpected response.";
    case "http_status":
      return "GitHub returned an unexpected status.";
    case "unconfigured":
      return "GitHub Read is not configured.";
    default:
      return "GitHub request failed.";
  }
}

export function actionErrorCodeForGitHub(category: GitHubFailureCategory):
  | "timeout"
  | "aborted"
  | "execution_failed" {
  if (category === "timeout") return "timeout";
  if (category === "aborted") return "aborted";
  return "execution_failed";
}
