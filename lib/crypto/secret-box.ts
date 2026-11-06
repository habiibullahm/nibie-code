import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SecretPayload = { apiKey: string; headers: { name: string; value: string }[] };

type Env = Record<string, string | undefined>;

function keyBytes(env: Env): Buffer {
  const raw = env.PROVIDER_SECRET_KEY?.trim();
  if (!raw) throw new Error("PROVIDER_SECRET_KEY is not configured.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PROVIDER_SECRET_KEY must be 32 bytes of base64.");
  return key;
}

export function encryptSecret(payload: SecretPayload, env: Env = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(env), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(packed: string, env: Env = process.env): SecretPayload {
  const [version, ivPart, tagPart, dataPart] = packed.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) throw new Error("Provider secret could not be decrypted.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(env), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const json = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as SecretPayload;
    if (typeof parsed.apiKey !== "string" || !Array.isArray(parsed.headers)) throw new Error("bad shape");
    return parsed;
  } catch {
    throw new Error("Provider secret could not be decrypted.");
  }
}
