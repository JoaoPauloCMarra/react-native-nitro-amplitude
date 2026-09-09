const fs = require("node:fs");

const smokeSource = fs.readFileSync(
  "apps/example/components/smoke-test.tsx",
  "utf8",
);
const appSource = fs.readFileSync("apps/example/app/index.tsx", "utf8");
const maestroFlow = fs.readFileSync("maestro/smoke-tests.yaml", "utf8");
const packageManifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
const exampleManifest = JSON.parse(
  fs.readFileSync("apps/example/package.json", "utf8"),
);
const requiredSourceMarkers = [
  'testID="smoke-summary"',
  'testID="smoke-run-all"',
  'title="Run All"',
  'next.filter((entry) => entry.status === "pass")',
  'run("Diagnostics and health check"',
  'run("Testing helpers and typed variants"',
];
const requiredFlowMarkers = [
  "appId: com.nitroamplitude.example",
  'visible: "Smoke Test"',
  'id: "runtime-mode"',
  'text: "dry-run fixture"',
  'text: ".*passed.*"',
  'text: "Complete: PASS: .*0 failed.*"',
];
const requiredAppMarkers = [
  'testID="runtime-mode"',
  'value="dry-run fixture"',
  "DRY_RUN ?",
  '"nitro-amplitude-dry-run-analytics-key"',
  '"nitro-amplitude-dry-run-experiment-key"',
];

for (const marker of requiredSourceMarkers) {
  if (!smokeSource.includes(marker)) {
    throw new Error(`Example smoke source is missing: ${marker}`);
  }
}

for (const marker of requiredFlowMarkers) {
  if (!maestroFlow.includes(marker)) {
    throw new Error(`Maestro flow is missing: ${marker}`);
  }
}

const runtimeMarkerIndex = maestroFlow.indexOf('id: "runtime-mode"');
const firstTapIndex = maestroFlow.indexOf("- tapOn:");
if (runtimeMarkerIndex > firstTapIndex) {
  throw new Error(
    "Maestro flow must assert dry-run fixture mode before tapping",
  );
}

for (const marker of requiredAppMarkers) {
  if (!appSource.includes(marker)) {
    throw new Error(`Example app is missing: ${marker}`);
  }
}

if (
  packageManifest.scripts?.["example:smoke"] !==
  "bun scripts/run-example-smoke.js"
) {
  throw new Error(
    "package.json example:smoke must run the dry-run smoke guard",
  );
}

if (
  packageManifest.scripts?.["example:smoke:fixture"] !==
  "EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1 bun scripts/run-example-smoke.js"
) {
  throw new Error(
    "package.json example:smoke:fixture must provide the dry-run smoke path",
  );
}

if (
  packageManifest.scripts?.["example:start:fixture"] !==
  "bun run --cwd apps/example start:fixture"
) {
  throw new Error(
    "package.json example:start:fixture must start Metro in dry-run mode",
  );
}

if (
  exampleManifest.scripts?.["start:fixture"] !==
  "EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1 env -u NO_COLOR expo start -d"
) {
  throw new Error(
    "apps/example/package.json start:fixture must bake dry-run mode into Metro",
  );
}

const testCount = (smokeSource.match(/\brun\("/g) ?? []).length;
if (testCount < 8) {
  throw new Error(`Example smoke suite is unexpectedly small: ${testCount}`);
}

console.log(
  `Example smoke contract is valid: ${testCount} labeled checks and terminal-state Maestro assertions.`,
);
