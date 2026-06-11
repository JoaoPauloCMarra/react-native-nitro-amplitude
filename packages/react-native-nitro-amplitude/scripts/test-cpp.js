const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const cppDir = path.join(__dirname, "..", "cpp");
const buildDir = path.join(cppDir, "build");
const packageRoot = path.join(__dirname, "..");
const workspaceRoot = path.join(packageRoot, "..", "..");

if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDir, { recursive: true });

const nitroDir = [
  path.join(packageRoot, "node_modules", "react-native-nitro-modules", "cpp"),
  path.join(workspaceRoot, "node_modules", "react-native-nitro-modules", "cpp"),
].find((candidate) => fs.existsSync(candidate));

if (!nitroDir) {
  console.error("❌ react-native-nitro-modules cpp headers not found.");
  process.exit(1);
}

const includeRoot = path.join(buildDir, "headers");
const nitroVirtualDir = path.join(includeRoot, "NitroModules");
fs.mkdirSync(nitroVirtualDir, { recursive: true });

const nitroSubdirs = [
  "core",
  "platform",
  "registry",
  "jsi",
  "utils",
  "threading",
  "views",
  "entrypoint",
  "prototype",
  "templates",
];

for (const subdir of nitroSubdirs) {
  const src = path.join(nitroDir, subdir);
  if (!fs.existsSync(src)) continue;
  for (const file of fs.readdirSync(src)) {
    if (file.endsWith(".h") || file.endsWith(".hpp")) {
      fs.copyFileSync(path.join(src, file), path.join(nitroVirtualDir, file));
    }
  }
}

fs.writeFileSync(
  path.join(nitroVirtualDir, "HybridObject.hpp"),
  `#pragma once
#include <memory>
namespace margelo::nitro {
class Prototype {
public:
  template <typename... Args>
  void registerHybridMethod(const char*, Args...) {}
};
class HybridObject : public std::enable_shared_from_this<HybridObject> {
public:
  explicit HybridObject(const char* = "") {}
  virtual ~HybridObject() = default;
  virtual void loadHybridMethods() {}
  virtual size_t getExternalMemorySize() noexcept { return 0; }
protected:
  template <typename Fn>
  void registerHybrids(HybridObject*, Fn&& fn) {
    Prototype prototype;
    fn(prototype);
  }
};
}
`,
  "utf8",
);

const generatedDir = path.join(
  packageRoot,
  "nitrogen",
  "generated",
  "shared",
  "c++",
);

const testFile = path.join(cppDir, "bindings", "HybridAmplitudeStorageTest.cpp");
const contextSource = path.join(cppDir, "bindings", "HybridAmplitudeContext.cpp");
const storageSource = path.join(cppDir, "bindings", "HybridAmplitudeStorage.cpp");
const workerSource = path.join(cppDir, "bindings", "HybridAmplitudeWorker.cpp");
const contextSpec = path.join(generatedDir, "HybridAmplitudeContextSpec.cpp");
const storageSpec = path.join(generatedDir, "HybridAmplitudeStorageSpec.cpp");
const workerSpec = path.join(generatedDir, "HybridAmplitudeWorkerSpec.cpp");
const outputFile = path.join(buildDir, "hybrid_amplitude_storage_test");

const sanitizers = process.env.NITRO_CPP_SANITIZE;

const compileCmd = [
  "clang++",
  "-std=c++20",
  "-g",
  sanitizers ? `-fsanitize=${sanitizers} -fno-omit-frame-pointer -O1` : "",
  "-DNITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER",
  process.platform === "darwin" ? "-stdlib=libc++" : "",
  `-I${includeRoot}`,
  `-I${path.join(cppDir, "core")}`,
  `-I${path.join(cppDir, "bindings")}`,
  `-I${generatedDir}`,
  testFile,
  contextSource,
  storageSource,
  workerSource,
  contextSpec,
  storageSpec,
  workerSpec,
  `-o ${outputFile}`,
]
  .filter(Boolean)
  .join(" ");

try {
  execSync(compileCmd, { stdio: "inherit" });
  execSync(outputFile, { stdio: "inherit" });
  console.log("✅ C++ tests passed!");
} catch {
  console.error("❌ C++ tests failed.");
  process.exit(1);
}
