import { spawnSync } from "node:child_process";

const composeFile = "docker-compose.test.yml";
const testEnv = {
  ...process.env,
  TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55433/nibie_ai",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55433/nibie_ai",
  ALLOW_TEST_DATABASE_RESET: "1",
};

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const error = new Error(command + " " + args.join(" ") + " failed with exit code " + result.status);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

let exitCode = 0;

try {
  run("docker", ["compose", "-f", composeFile, "up", "-d", "--wait"]);
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "test:integration"], testEnv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = error?.exitCode ?? 1;
} finally {
  try {
    run("docker", ["compose", "-f", composeFile, "down", "-v"]);
  } catch (error) {
    console.error("Failed to clean up local test database.");
    console.error(error instanceof Error ? error.message : error);
    exitCode ||= error?.exitCode ?? 1;
  }
}

process.exit(exitCode);
