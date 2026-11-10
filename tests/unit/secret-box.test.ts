import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../../lib/crypto/secret-box";

const env = { PROVIDER_SECRET_KEY: Buffer.alloc(32, 7).toString("base64") };

describe("secret box", () => {
  it("round-trips the key and headers and does not echo the key in the packed prefix", () => {
    const payload = { apiKey: "sk-test-key", headers: [{ name: "X-Title", value: "nibie" }] };
    const packed = encryptSecret(payload, env);
    expect(packed.startsWith("v1.")).toBe(true);
    expect(packed).not.toContain("sk-test-key");
    expect(decryptSecret(packed, env)).toEqual(payload);
  });

  it("rejects a missing key and a tampered tag", () => {
    const packed = encryptSecret({ apiKey: "sk-test-key", headers: [] }, env);
    expect(() => encryptSecret({ apiKey: "k", headers: [] }, {})).toThrow(/PROVIDER_SECRET_KEY/);
    const parts = packed.split(".");
    parts[2] = Buffer.alloc(16, 1).toString("base64url");
    expect(() => decryptSecret(parts.join("."), env)).toThrow(/decrypt/);
  });
});
