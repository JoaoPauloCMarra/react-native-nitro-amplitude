const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  assertDryRunEnvironment,
  runExampleSmoke,
} = require("./run-example-smoke.js");

function fixtureEnv(value) {
  return { EXPO_PUBLIC_AMPLITUDE_DRY_RUN: value };
}

test("refuses live mode before spawning Maestro", () => {
  assert.throws(
    () => assertDryRunEnvironment(fixtureEnv("0")),
    /Refusing example smoke/,
  );
  assert.throws(
    () => assertDryRunEnvironment({}),
    /EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1/,
  );

  let spawnCalls = 0;
  assert.throws(
    () =>
      runExampleSmoke({
        env: fixtureEnv("0"),
        spawn: () => {
          spawnCalls += 1;
          return { status: 0 };
        },
      }),
    /Refusing example smoke/,
  );
  assert.equal(spawnCalls, 0);
});

test("runs the expected Maestro flow in fixture mode", () => {
  const calls = [];
  assert.equal(
    runExampleSmoke({
      env: fixtureEnv("1"),
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    }),
    0,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], "bunx");
  assert.deepEqual(calls[0][1], [
    "maestro",
    "test",
    "maestro/smoke-tests.yaml",
  ]);
  assert.equal(calls[0][2].env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN, "1");
});

test("returns the Maestro exit status", () => {
  assert.equal(
    runExampleSmoke({
      env: fixtureEnv("1"),
      spawn: () => ({ status: 17 }),
    }),
    17,
  );
});

test("refuses E2E in live mode before launching an app", () => {
  let spawnCalls = 0;
  assert.throws(() => runExampleSmoke({
    env: fixtureEnv("0"),
    e2eArgs: ["e2e/qa-full-features.ad"],
    spawn: () => { spawnCalls += 1; return { status: 0 }; },
  }), /Refusing example smoke/);
  assert.equal(spawnCalls, 0);
});

test("runs the selected E2E flow with the explicit device in fixture mode", () => {
  const calls = [];
  const e2eArgs = ["e2e/qa-full-features.ad", "--device", "RN Expo MidRange", "--retries", "1"];
  const status = runExampleSmoke({
    env: fixtureEnv("1"),
    e2eArgs,
    spawn: (...args) => { calls.push(args); return { status: 9 }; },
  });
  assert.equal(status, 9);
  assert.equal(calls[0][0], "agent-device");
  assert.deepEqual(calls[0][1], ["test", ...e2eArgs]);
});

console.log("Example smoke runner guard tests passed.");
