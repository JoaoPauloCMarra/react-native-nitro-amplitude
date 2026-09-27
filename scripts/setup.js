#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
};

const projectRoot = path.resolve(__dirname, "..");

function log(message, color = "green") {
  console.log(colors[color](message));
}

function execCommand(command, options = {}) {
  try {
    execSync(command, {
      stdio: "inherit",
      cwd: projectRoot,
      shell: true,
      ...options,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function commandExists(command) {
  try {
    const checkCommand =
      process.platform === "win32"
        ? `where ${command}`
        : `command -v ${command}`;
    execSync(checkCommand, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function main(dependencies = {}) {
  const output = dependencies.console || console;
  const report = dependencies.log || log;
  const hasCommand = dependencies.commandExists || commandExists;
  const runCommand = dependencies.execCommand || execCommand;

  output.log("");
  report("🚀 Setting up react-native-nitro-amplitude...");
  output.log("");

  if (!hasCommand("bun")) {
    report("Bun not found. Please install bun first:", "yellow");
    report("  • macOS/Linux: curl -fsSL https://bun.sh/install | bash", "cyan");
    report('  • Windows: powershell -c "irm bun.sh/install.ps1 | iex"', "cyan");
    report("  • Or visit: https://bun.sh/docs/installation", "cyan");
    return 1;
  }

  report("📦 Installing dependencies...");
  if (!runCommand("bun install")) {
    report("Failed to install dependencies", "red");
    return 1;
  }

  report("⚡ Generating Nitro bindings...");
  const packageDir = path.join(
    projectRoot,
    "packages/react-native-nitro-amplitude",
  );
  if (!runCommand("bun run codegen", { cwd: packageDir })) {
    report("Failed to generate Nitro bindings", "red");
    return 1;
  }

  report("🔨 Building library...");
  if (!runCommand("bun run build", { cwd: packageDir })) {
    report("Failed to build library", "red");
    return 1;
  }

  output.log("");
  report("✅ Setup complete!");
  output.log("");
  output.log("Next steps:");
  output.log("  1. cd apps/example");
  output.log("  2. bun run prebuild");
  output.log("  3. bun run ios  # or bun run android");
  output.log("");
  return 0;
}

if (require.main === module) {
  main()
    .then((status) => {
      if (status !== 0) {
        process.exitCode = status;
      }
    })
    .catch((error) => {
      log(`Setup failed: ${error.message}`, "red");
      process.exitCode = 1;
    });
}

module.exports = { main };
