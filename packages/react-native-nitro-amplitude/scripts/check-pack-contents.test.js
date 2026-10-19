"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const script = path.join(__dirname, "check-pack-contents.js");
const result = spawnSync(process.execPath, [script], {
  cwd: os.tmpdir(),
  encoding: "utf8",
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(
  `${result.stdout}\n${result.stderr}`,
  /Pack contents check passed/,
);
console.log("pack contents unexpected-cwd test passed");

const scriptSource = fs.readFileSync(script, "utf8");
const nativeBuildFiles = [
  "cpp/core/Gzip.cpp",
  "cpp/core/Gzip.hpp",
  "cpp/bindings/HybridAmplitudeContext.hpp",
  "cpp/bindings/HybridAmplitudeStorage.hpp",
  "cpp/bindings/HybridAmplitudeWorker.hpp",
  "android/consumer-rules.pro",
  "android/gradle.properties",
  "android/src/main/cpp/cpp-adapter.cpp",
  "android/src/main/java/com/nitroamplitude/NitroAmplitudePackage.kt",
];
for (const file of nativeBuildFiles) {
  assert.ok(
    scriptSource.includes(`"${file}"`),
    `pack audit must require ${file}`,
  );
}
console.log("pack contents native build files test passed");
