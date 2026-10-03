import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  checkReplayFreshness,
  collectRuntimeFiles,
  refreshReplayLock,
} from "./check-example-replay-freshness.js";
import { createExampleReplayHttpFixture } from "./example-replay-http-fixture.js";
import {
  parseArgs,
  readSuites,
  runExampleReplay,
} from "./run-example-replay.js";

const projectRoot = path.resolve(__dirname, "..");
const localFixtureUrl = "http://10.0.2.2:4318";

function writeFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createFreshnessFixture(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "nitro-amplitude-replay-lock-test-"),
  );
  writeFile(
    root,
    "packages/react-native-nitro-amplitude/src/index.ts",
    "export const version = 1;\n",
  );
  writeFile(
    root,
    "apps/example/components/e2e-lab.tsx",
    '<Button testID="probe-run" /><StatusRow testID="probe-status" /> ok:probe\n',
  );
  writeFile(
    root,
    "e2e/replay.ad",
    'wait text "dry-run fixture"\npress id="probe-run"\nwait text "ok:probe"\n',
  );
  writeFile(
    root,
    "apps/example/app/e2e.tsx",
    'if (process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN !== "1") return null;\nconst marker = "dry-run fixture";\n',
  );
  writeFile(
    root,
    "e2e/coverage.json",
    `${JSON.stringify(
      {
        version: 1,
        suites: [{ path: "e2e/replay.ad" }],
        fixtureMarker: {
          source: "apps/example/app/e2e.tsx",
          guardFragment: 'process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN !== "1"',
          text: "dry-run fixture",
          suites: ["e2e/replay.ad"],
        },
        features: [
          {
            id: "probe.check",
            coverage: "replay-asserted",
            transport: "local fixture",
            suite: "e2e/replay.ad",
            source: "apps/example/components/e2e-lab.tsx",
            controlId: "probe-run",
            statusId: "probe-status",
            statusFragment: "ok:probe",
            expectedText: "ok:probe",
          },
        ],
        pending: [
          {
            id: "provider.pending",
            state: "pending-prerequisites",
            reason: "Requires a staging key",
            prerequisites: ["approved key"],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function relativeTo(directory: string, candidate: string): string {
  return path.relative(path.resolve(directory), path.resolve(candidate));
}

test("the checked-in replay manifest and source lock are current", () => {
  const result = checkReplayFreshness({ root: projectRoot });
  assert.equal(result.fresh, true, result.reason);
});

test("runtime source drift fails freshness until the reviewed lock is refreshed", () => {
  const root = createFreshnessFixture();
  const manifestPath = "e2e/coverage.json";
  const lockPath = "e2e/lock.json";
  try {
    const initial = refreshReplayLock({ root, manifestPath, lockPath });
    assert.equal(
      checkReplayFreshness({ root, manifestPath, lockPath }).fresh,
      true,
    );

    writeFile(
      root,
      "packages/react-native-nitro-amplitude/src/index.ts",
      "export const version = 2;\n",
    );
    const stale = checkReplayFreshness({ root, manifestPath, lockPath });
    assert.equal(stale.fresh, false);
    assert.notEqual(
      stale.expected.runtimeSourceSha256,
      initial.runtimeSourceSha256,
    );

    const refreshed = refreshReplayLock({ root, manifestPath, lockPath });
    assert.notEqual(refreshed.runtimeSourceSha256, initial.runtimeSourceSha256);
    assert.equal(
      checkReplayFreshness({ root, manifestPath, lockPath }).fresh,
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing platform or exact target fails before agent-device can spawn", () => {
  const calls: unknown[][] = [];
  const spawn = (...args: unknown[]) => {
    calls.push(args);
    return { status: 0 };
  };
  assert.throws(
    () =>
      runExampleReplay({
        argv: [
          "--udid",
          "sim-1",
          "--http-fixture-url",
          "http://127.0.0.1:4318",
        ],
        env: {},
        spawn,
      }),
    /--platform must be ios or android/,
  );
  assert.throws(
    () =>
      runExampleReplay({
        argv: [
          "--platform",
          "ios",
          "--http-fixture-url",
          "http://127.0.0.1:4318",
        ],
        env: {},
        spawn,
      }),
    /Provide one exact ios target with --udid/,
  );
  assert.equal(calls.length, 0);
});

test("ambiguous targets and non-local fixture URLs are rejected", () => {
  assert.throws(
    () =>
      parseArgs([
        "--platform",
        "ios",
        "--udid",
        "sim-1,sim-2",
        "--http-fixture-url",
        "http://127.0.0.1:4318",
      ]),
    /comma-separated targets are ambiguous/,
  );
  assert.throws(
    () =>
      parseArgs([
        "--platform",
        "android",
        "--serial",
        "emulator-5554",
        "--http-fixture-url",
        "http://example.com:4318",
      ]),
    /must be a local HTTP origin/,
  );
  assert.equal(
    parseArgs([
      "--platform",
      "android",
      "--serial",
      "emulator-5554",
      "--http-fixture-url",
      localFixtureUrl,
    ]).fixtureUrl,
    localFixtureUrl,
  );
});

test("runner relies on the app fixture marker rather than shell environment", () => {
  const artifacts: string[] = [];
  let spawnCalls = 0;
  try {
    const status = runExampleReplay({
      argv: [
        "--platform",
        "ios",
        "--udid",
        "sim-1",
        "--http-fixture-url",
        "http://127.0.0.1:4318",
      ],
      env: {},
      makeTempDirectory: (prefix: string) => {
        const directory = fs.mkdtempSync(prefix);
        artifacts.push(directory);
        return directory;
      },
      spawn: () => {
        spawnCalls += 1;
        return { status: 0 };
      },
    });
    assert.equal(status, 0);
    assert.equal(spawnCalls, 1);
    assert.match(
      fs.readFileSync(
        path.join(projectRoot, "e2e/qa-full-features.ad"),
        "utf8",
      ),
      /wait text "dry-run fixture"/,
    );
  } finally {
    for (const directory of artifacts) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("runner uses the manifest suites, exact target, unique OS temp artifacts, and fixture values", () => {
  const calls: {
    command: string;
    args: string[];
    options: { cwd: string };
  }[] = [];
  const artifacts: string[] = [];
  const status = runExampleReplay({
    argv: [
      "--platform",
      "ios",
      "--udid",
      "device-123",
      "--http-fixture-url",
      "http://127.0.0.1:4318",
    ],
    env: {},
    uuid: () => "run-123",
    makeTempDirectory: (prefix: string) => {
      const directory = fs.mkdtempSync(prefix);
      artifacts.push(directory);
      return directory;
    },
    spawn: (command: string, args: string[], options: { cwd: string }) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  try {
    assert.equal(status, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "agent-device");
    assert.deepEqual(calls[0]?.args, [
      "test",
      "e2e/qa-full-features.ad",
      "e2e/qa-persistence-relaunch.ad",
      "e2e/qa-deeplink.ad",
      "--platform",
      "ios",
      "--udid",
      "device-123",
      "--session",
      "nitro-amplitude-replay-run-123",
      "--env",
      "FIXTURE_URL=http%3A%2F%2F127.0.0.1%3A4318",
      "--env",
      "RUN_ID=run-123",
      "--artifacts-dir",
      artifacts[0],
      "--fail-fast",
      "--retries",
      "0",
      "--timeout",
      "180000",
    ]);
    assert.equal(calls[0]?.options.cwd, projectRoot);
    assert.equal(artifacts.length, 1);
    assert.equal(
      relativeTo(os.tmpdir(), artifacts[0] ?? "").startsWith(".."),
      false,
    );
    assert.equal(
      relativeTo(projectRoot, artifacts[0] ?? "").startsWith(".."),
      true,
    );
  } finally {
    for (const directory of artifacts) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("nonzero replay status propagates without another agent-device call", () => {
  const calls: { command: string; args: string[] }[] = [];
  const artifacts: string[] = [];
  const status = runExampleReplay({
    argv: [
      "--platform",
      "android",
      "--serial",
      "emulator-5554",
      "--http-fixture-url",
      localFixtureUrl,
    ],
    env: {},
    uuid: () => "failed-run",
    makeTempDirectory: (prefix: string) => {
      const directory = fs.mkdtempSync(prefix);
      artifacts.push(directory);
      return directory;
    },
    spawn: (command: string, args: string[]) => {
      calls.push({ command, args });
      return { status: 17 };
    },
  });
  try {
    assert.equal(status, 17);
    assert.equal(calls.length, 1);
  } finally {
    for (const directory of artifacts) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("spawn errors propagate without another agent-device call", () => {
  const calls: { command: string; args: string[] }[] = [];
  const artifacts: string[] = [];
  const spawnError = Object.assign(new Error("agent-device missing"), {
    code: "ENOENT",
  });
  try {
    assert.throws(
      () =>
        runExampleReplay({
          argv: [
            "--platform",
            "ios",
            "--udid",
            "device-123",
            "--http-fixture-url",
            "http://127.0.0.1:4318",
          ],
          env: {},
          uuid: () => "spawn-error",
          makeTempDirectory: (prefix: string) => {
            const directory = fs.mkdtempSync(prefix);
            artifacts.push(directory);
            return directory;
          },
          spawn: (command: string, args: string[]) => {
            calls.push({ command, args });
            return { error: spawnError, status: null };
          },
        }),
      /agent-device missing/,
    );
    assert.equal(calls.length, 1);
  } finally {
    for (const directory of artifacts) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("local fixture serves health, echoes POST data, and preserves an HTTP 503", async () => {
  const fixture = createExampleReplayHttpFixture({
    bindHost: "127.0.0.1",
    advertiseHost: "127.0.0.1",
    port: 0,
  });
  const { baseUrl } = await fixture.listen();
  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      fixture: "nitro-amplitude-replay",
    });

    const echo = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"probe":"e2e-native-http-probe"}',
    });
    assert.equal(echo.status, 200);
    assert.deepEqual(await echo.json(), {
      ok: true,
      fixture: "nitro-amplitude-replay",
      method: "POST",
      path: "/echo",
      body: '{"probe":"e2e-native-http-probe"}',
    });

    const unavailable = await fetch(`${baseUrl}/status/503`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), {
      ok: false,
      fixture: "nitro-amplitude-replay",
      status: 503,
    });
  } finally {
    await fixture.close();
  }
});

test("all example source, assets and generated bindings are watched without generated app projects", () => {
  const root = createFreshnessFixture();
  try {
    for (const file of [
      "apps/example/components/smoke-test.tsx",
      "apps/example/hooks/use-theme.ts",
      "apps/example/theme.ts",
      "apps/example/assets/qa-font.ttf",
      "packages/react-native-nitro-amplitude/nitrogen/generated/shared/Probe.hpp",
    ]) {
      writeFile(root, file, "runtime fixture\n");
    }
    writeFile(root, "apps/example/android/app/src/main/Main.kt", "generated\n");
    writeFile(root, "apps/example/ios/AppDelegate.swift", "generated\n");
    writeFile(root, "apps/example/.env.local", "DO_NOT_HASH\n");
    writeFile(
      root,
      "packages/react-native-nitro-amplitude/cpp/ProbeTest.cpp",
      "unit test\n",
    );
    const files = collectRuntimeFiles(root);
    for (const file of [
      "apps/example/components/smoke-test.tsx",
      "apps/example/hooks/use-theme.ts",
      "apps/example/theme.ts",
      "apps/example/assets/qa-font.ttf",
      "packages/react-native-nitro-amplitude/nitrogen/generated/shared/Probe.hpp",
    ])
      assert.ok(files.includes(file), file);
    assert.ok(
      !files.some(
        (file: string) =>
          file.startsWith("apps/example/android/") ||
          file.startsWith("apps/example/ios/"),
      ),
    );
    assert.ok(!files.includes("apps/example/.env.local"));
    assert.ok(
      !files.includes(
        "packages/react-native-nitro-amplitude/cpp/ProbeTest.cpp",
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("git-ignored files inside hashed directories are not watched", () => {
  const root = createFreshnessFixture();
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
    writeFile(root, ".gitignore", "apps/example/expo-env.d.ts\n");
    writeFile(root, "apps/example/expo-env.d.ts", "generated\n");
    writeFile(root, "apps/example/env.d.ts", "declare const probe: string;\n");
    const files = collectRuntimeFiles(root);
    assert.ok(!files.includes("apps/example/expo-env.d.ts"));
    assert.ok(files.includes("apps/example/env.d.ts"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("external symlink flows fail before a runner spawn or lock refresh", () => {
  const root = createFreshnessFixture();
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "nitro-amplitude-external-flow-"),
  );
  const manifestPath = "e2e/coverage.json";
  try {
    const manifestFile = path.join(root, manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const suiteFile = path.join(root, manifest.suites[0].path);
    const outsideFile = path.join(outside, "external.ad");
    fs.copyFileSync(suiteFile, outsideFile);
    fs.unlinkSync(suiteFile);
    fs.symlinkSync(outsideFile, suiteFile);
    assert.throws(() => readSuites(manifestFile), /symlink|missing/);
    assert.throws(
      () =>
        refreshReplayLock({
          root,
          manifestPath,
          lockPath: "e2e/test-lock.json",
        }),
      /symlink|missing/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
