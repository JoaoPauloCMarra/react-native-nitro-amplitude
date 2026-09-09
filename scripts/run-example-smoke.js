const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const maestroArgs = ["maestro", "test", "maestro/smoke-tests.yaml"];

function assertDryRunEnvironment(env = process.env) {
  if (env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN !== "1") {
    throw new Error(
      "Refusing example smoke: start Metro with " +
        "EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1 (example:start:fixture) before " +
        "example:smoke:fixture.",
    );
  }
}

function runExampleSmoke({ env = process.env, spawn = spawnSync, e2eArgs } = {}) {
  assertDryRunEnvironment(env);

  const command = e2eArgs ? "agent-device" : "bunx";
  const args = e2eArgs ? ["test", ...e2eArgs] : maestroArgs;
  const result = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return typeof result.status === "number" ? result.status : 1;
}

if (require.main === module) {
  try {
    const [mode, ...e2eArgs] = process.argv.slice(2);
    if (mode !== undefined && mode !== "--e2e") {
      throw new Error(`Unknown example test mode: ${mode}`);
    }
    process.exitCode = runExampleSmoke({
      e2eArgs: mode === "--e2e" ? e2eArgs : undefined,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { assertDryRunEnvironment, runExampleSmoke };
