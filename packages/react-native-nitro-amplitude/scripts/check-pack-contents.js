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
  "src/network.ts",
  "src/testing.ts",
  "src/analytics/index.ts",
  "src/experiment/index.ts",
  "lib/commonjs/index.js",
  "lib/commonjs/network.js",
  "lib/commonjs/testing.js",
  "lib/commonjs/analytics/index.js",
  "lib/commonjs/experiment/index.js",
  "lib/module/index.js",
  "lib/module/network.js",
  "lib/module/testing.js",
  "lib/module/analytics/index.js",
  "lib/module/experiment/index.js",
  "lib/typescript/index.d.ts",
  "lib/typescript/network.d.ts",
  "lib/typescript/testing.d.ts",
  "lib/typescript/analytics/index.d.ts",
  "lib/typescript/experiment/index.d.ts",
  "cpp/core/ContextAdapter.hpp",
  "cpp/core/HttpAdapter.hpp",
  "cpp/core/StorageAdapter.hpp",
  "cpp/core/PlatformAdapterFactory.hpp",
  "cpp/bindings/HybridAmplitudeContext.cpp",
  "cpp/bindings/HybridAmplitudeStorage.cpp",
  "cpp/bindings/HybridAmplitudeWorker.cpp",
  "ios/IOSAmplitudeAdapterCpp.hpp",
  "ios/IOSAmplitudeAdapterCpp.mm",
  "react-native-nitro-amplitude.podspec",
  "android/build.gradle",
  "android/CMakeLists.txt",
  "android/src/main/AndroidManifest.xml",
  "android/src/main/java/com/nitroamplitude/AndroidAmplitudeAdapter.kt",
  "android/src/main/java/com/nitroamplitude/NitroAmplitudeInitializer.kt",
  "android/src/main/cpp/AndroidAmplitudeAdapterCpp.hpp",
  "android/src/main/cpp/AndroidAmplitudeAdapterCpp.cpp",
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

function parseBunPackOutput(output) {
  const files = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^packed\s+\S+\s+(.+)$/);
    if (!match) {
      continue;
    }
    let entryPath = match[1].trim();
    if (entryPath.startsWith('"') && entryPath.endsWith('"')) {
      entryPath = entryPath.slice(1, -1);
    }
    files.push(entryPath);
  }
  return files;
}

let packedFiles;
try {
  const output = execSync("bun pm pack --dry-run --ignore-scripts", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  packedFiles = parseBunPackOutput(output);
} catch (error) {
  fail(`bun pm pack --dry-run failed: ${error.message}`);
}

if (!packedFiles || packedFiles.length === 0) {
  fail("bun pm pack produced no file list.");
}

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
