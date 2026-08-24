const fs = require("node:fs");

const smokeSource = fs.readFileSync(
  "apps/example/components/smoke-test.tsx",
  "utf8",
);
const maestroFlow = fs.readFileSync("maestro/smoke-tests.yaml", "utf8");
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
  'text: ".*passed.*"',
  'text: ".*0 failed.*"',
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

const testCount = (smokeSource.match(/\brun\("/g) ?? []).length;
if (testCount < 8) {
  throw new Error(`Example smoke suite is unexpectedly small: ${testCount}`);
}

console.log(
  `Example smoke contract is valid: ${testCount} labeled checks and terminal-state Maestro assertions.`,
);
