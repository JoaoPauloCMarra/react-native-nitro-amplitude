const { execSync } = require("child_process");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const requiredFiles = [
  "README.md",
  "LICENSE",
  "app.plugin.js",
  ".watchmanconfig",
  "nitro.json",
  "nitrogen/generated/shared/c++/HybridAmplitudeContextSpec.hpp",
  "nitrogen/generated/shared/c++/HybridAmplitudeStorageSpec.hpp",
  "nitrogen/generated/shared/c++/HybridAmplitudeWorkerSpec.hpp",
  "src/index.ts",
  "src/index.web.ts",
  "lib/commonjs/index.js",
  "lib/module/index.js",
  "lib/typescript/index.d.ts",
];

const forbiddenPatterns = [
  /^src\/__tests__\//,
  /^scripts\//,
  /^cpp\/build\//,
  /^android\/build\//,
  /^android\/\.cxx\//,
  /(?:^|\/)\.env(?:\.|$)/,
  /(?:^|\/)npm-debug\.log$/,
  /(?:^|\/)[^/]*Test\.cpp$/,
];

let packMetadata;
try {
  const output = execSync("npm pack --dry-run --json", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output);
  packMetadata = Array.isArray(parsed) ? parsed[0] : parsed;
} catch (error) {
  fail(`npm pack --dry-run failed: ${error.message}`);
}

const packedFiles = packMetadata.files.map((entry) => entry.path);

for (const required of requiredFiles) {
  if (!packedFiles.includes(required)) {
    fail(`Missing required packed file: ${required}`);
  }
}

for (const packed of packedFiles) {
  if (forbiddenPatterns.some((pattern) => pattern.test(packed))) {
    fail(`Forbidden packed file: ${packed}`);
  }
}

console.log(`✅ Pack contents check passed (${packedFiles.length} files).`);
