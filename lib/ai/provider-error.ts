import "server-only";

export type ProviderFailureCode = "authentication_failed" | "insufficient_balance" | "rate_limited" | "rejected" | "unavailable";

const messages: Record<ProviderFailureCode, string> = {
  authentication_failed: "The provider rejected the API key.",
  insufficient_balance: "The provider reported insufficient balance.",
  rate_limited: "The provider rate limit was reached. Try again later.",
  rejected: "The provider rejected the request.",
  unavailable: "The provider is unavailable.",
};

export class ProviderRequestError extends Error {
  constructor(public readonly code: ProviderFailureCode, public readonly status: number | null) {
    super(messages[code]);
  }
}

const balanceCodes = new Set(["insufficient_quota", "insufficient_balance", "billing_not_active", "payment_required"]);

export function mapProviderFailure(status: number, errorCode: string | null): ProviderRequestError {
  if (status === 401 || status === 403) return new ProviderRequestError("authentication_failed", status);
  if (status === 402 || (errorCode !== null && balanceCodes.has(errorCode))) return new ProviderRequestError("insufficient_balance", status);
  if (status === 429) return new ProviderRequestError("rate_limited", status);
  if (status >= 500 || status === 0) return new ProviderRequestError("unavailable", status);
  return new ProviderRequestError("rejected", status);
}
