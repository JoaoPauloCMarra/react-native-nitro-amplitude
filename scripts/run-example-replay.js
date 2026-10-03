const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { isIP } = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { inside } = require("./check-example-replay-freshness.js");

const projectRoot = path.resolve(__dirname, "..");
const coveragePath = path.join(
  projectRoot,
  "e2e",
  "amplitude-replay-coverage.json",
);

function usage() {
  return [
    "Usage:",
    "  bun scripts/run-example-replay.js --platform ios --udid <simulator-or-device-udid> --http-fixture-url <local-fixture-url>",
    "  bun scripts/run-example-replay.js --platform android --serial <emulator-or-device-serial> --http-fixture-url <local-fixture-url>",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  const allowed = new Set([
    "--platform",
    "--udid",
    "--serial",
    "--http-fixture-url",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) {
      throw new Error(`Unknown replay option: ${flag}\n${usage()}`);
    }
    if (Object.hasOwn(options, flag)) {
      throw new Error(`Replay option may only be supplied once: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value\n${usage()}`);
    }
    options[flag] = value;
    index += 1;
  }
  return validateOptions(options);
}

function validateTarget(options) {
  const platform = options["--platform"];
  if (platform !== "ios" && platform !== "android") {
    throw new Error(`--platform must be ios or android\n${usage()}`);
  }
  const requiredTargetFlag = platform === "ios" ? "--udid" : "--serial";
  const forbiddenTargetFlag = platform === "ios" ? "--serial" : "--udid";
  if (options[forbiddenTargetFlag] !== undefined) {
    throw new Error(
      `${forbiddenTargetFlag} does not select a ${platform} target`,
    );
  }
  const target = options[requiredTargetFlag];
  if (!target || target.trim() === "") {
    throw new Error(
      `Provide one exact ${platform} target with ${requiredTargetFlag}\n${usage()}`,
    );
  }
  if (target.includes(",")) {
    throw new Error(
      `${requiredTargetFlag} must identify one target; comma-separated targets are ambiguous`,
    );
  }
  return { platform, targetFlag: requiredTargetFlag, target };
}

function isLocalFixtureHost(hostname) {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    host === "localhost" ||
    host === "host.docker.internal" ||
    host.endsWith(".local")
  ) {
    return true;
  }
  const version = isIP(host);
  if (version === 4) {
    const [first, second] = host.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (version === 6) {
    return (
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  }
  return false;
}

function parseFixtureUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--http-fixture-url must be a valid local HTTP URL");
  }
  if (
    url.protocol !== "http:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port === "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !isLocalFixtureHost(url.hostname)
  ) {
    throw new Error(
      "--http-fixture-url must be a local HTTP origin with an explicit port and no credentials, path, query, or fragment",
    );
  }
  return url.origin;
}

function validateOptions(options) {
  const target = validateTarget(options);
  const fixtureUrlValue = options["--http-fixture-url"];
  if (!fixtureUrlValue) {
    throw new Error(
      `Provide --http-fixture-url for the local native HTTP fixture\n${usage()}`,
    );
  }
  return {
    ...target,
    fixtureUrl: parseFixtureUrl(fixtureUrlValue),
  };
}

function isWithinDirectory(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function createArtifactsDirectory(makeTempDirectory = fs.mkdtempSync) {
  const directory = makeTempDirectory(
    path.join(os.tmpdir(), "nitro-amplitude-agent-device-"),
  );
  if (
    !isWithinDirectory(os.tmpdir(), directory) ||
    isWithinDirectory(projectRoot, directory)
  ) {
    throw new Error(
      "Replay artifacts must use a unique directory under the OS temporary directory",
    );
  }
  return directory;
}

function readSuites(manifestFile = coveragePath) {
  const root = path.resolve(path.dirname(manifestFile), "..");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (!Array.isArray(manifest.suites) || manifest.suites.length === 0) {
    throw new Error("Replay coverage manifest must list at least one suite");
  }
  return manifest.suites.map((suite) => {
    if (
      typeof suite.path !== "string" ||
      !suite.path.startsWith("e2e/") ||
      suite.path.includes("..") ||
      !suite.path.endsWith(".ad")
    ) {
      throw new Error("Replay coverage manifest contains an unsafe suite path");
    }
    const file = inside(root, suite.path);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile())
      throw new Error(`Replay flow is missing: ${suite.path}`);
    return suite.path;
  });
}

function runExampleReplay({
  argv,
  env = process.env,
  spawn = spawnSync,
  makeTempDirectory = fs.mkdtempSync,
  uuid = randomUUID,
  manifestFile = coveragePath,
  cwd = projectRoot,
} = {}) {
  const options = parseArgs(argv ?? []);
  const suites = readSuites(manifestFile);
  const artifactsDirectory = createArtifactsDirectory(makeTempDirectory);
  const runId = uuid();
  const session = `nitro-amplitude-replay-${runId}`;
  const args = [
    "test",
    ...suites,
    "--platform",
    options.platform,
    options.targetFlag,
    options.target,
    "--session",
    session,
    "--env",
    `FIXTURE_URL=${encodeURIComponent(options.fixtureUrl)}`,
    "--env",
    `RUN_ID=${runId}`,
    "--artifacts-dir",
    artifactsDirectory,
    "--fail-fast",
    "--retries",
    "0",
    "--timeout",
    "180000",
  ];
  const result = spawn("agent-device", args, {
    cwd,
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
    if (process.argv.includes("--help")) {
      process.stdout.write(`${usage()}\n`);
    } else {
      process.exitCode = runExampleReplay({ argv: process.argv.slice(2) });
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  readSuites,
  runExampleReplay,
};
