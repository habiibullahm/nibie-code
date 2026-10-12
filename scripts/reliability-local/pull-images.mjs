import fs from "node:fs";
import { spawnSync } from "node:child_process";

// Explicit preparation only. The test runner uses --pull never.
const compose = fs.readFileSync(new URL("./compose.yaml", import.meta.url), "utf8");
const images = [...compose.matchAll(/^\s+image: (\S+)$/gm)].map(match => match[1]);
if (images.length !== 3 || images.some(image => !/^[\w./-]+@sha256:[a-f0-9]{64}$/.test(image))) {
  throw new Error("Expected three immutable local QA image references.");
}
const env = { ...process.env };
for (const name of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete env[name];
for (const image of images) {
  const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", "pull", image], { env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Unable to prepare an immutable local QA image.");
}
