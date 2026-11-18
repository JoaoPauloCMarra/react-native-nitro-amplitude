const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const maestroArgs = ["test", "maestro/smoke-tests.yaml"];

function assertDryRunEnvironment(env = process.env) {
  if (env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN !== "1") {
    throw new Error(
      "Refusing example smoke: start Metro with " +
        "EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1 (example:start:fixture) before " +
        "example:smoke:fixture.",
    );
  }
}

function resolveDeviceEnv(e2eArgs, env) {
  const resolved = [];
  for (let index = 0; index < e2eArgs.length; index += 1) {
    if (e2eArgs[index] !== "--device-env") {
      resolved.push(e2eArgs[index]);
      continue;
    }
    const name = e2eArgs[index + 1];
    const device = name ? env[name] : undefined;
    if (!device) {
      throw new Error(
        `Set ${name ?? "the device variable"} to the simulator or device name before running this script.`,
      );
    }
    resolved.push("--device", device);
    index += 1;
  }
  return resolved;
}

function runExampleSmoke({ env = process.env, spawn = spawnSync, e2eArgs } = {}) {
  assertDryRunEnvironment(env);

  const command = e2eArgs ? "agent-device" : "maestro";
  const args = e2eArgs
    ? ["test", ...resolveDeviceEnv(e2eArgs, env)]
    : maestroArgs;
  const result = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    if (!e2eArgs && result.error.code === "ENOENT") {
      throw new Error("Install the Maestro CLI: https://maestro.dev");
    }
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
