"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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
