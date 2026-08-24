const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const coverageEnabled = process.argv.includes("--coverage");
const sanitizers =
  process.env.NITRO_CPP_SANITIZE ??
  process.argv.find((arg) => arg.startsWith("--sanitize="))?.split("=")[1];

if (coverageEnabled && sanitizers) {
  console.error("❌ Coverage and sanitizer modes cannot run together.");
  process.exit(1);
}

const cppDir = path.join(__dirname, "..", "cpp");
const buildMode = coverageEnabled
  ? "coverage"
  : sanitizers === undefined
    ? "default"
    : sanitizers;
const buildDir = path.join(cppDir, "build", buildMode);
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
const segmentStoreSource = path.join(cppDir, "core", "JsonlSegmentStore.cpp");
const contextSpec = path.join(generatedDir, "HybridAmplitudeContextSpec.cpp");
const storageSpec = path.join(generatedDir, "HybridAmplitudeStorageSpec.cpp");
const workerSpec = path.join(generatedDir, "HybridAmplitudeWorkerSpec.cpp");
const outputFile = path.join(buildDir, "hybrid_amplitude_storage_test");
const coverageSources = [
  contextSource,
  storageSource,
  workerSource,
  path.join(cppDir, "bindings", "HybridAmplitudeContext.hpp"),
  path.join(cppDir, "bindings", "HybridAmplitudeStorage.hpp"),
  path.join(cppDir, "bindings", "HybridAmplitudeWorker.hpp"),
];

const commonFlags = [
  "-std=c++20",
  "-g",
  "-DNITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER",
  ...(sanitizers
    ? [`-fsanitize=${sanitizers}`, "-fno-omit-frame-pointer", "-O1"]
    : []),
  ...(coverageEnabled
    ? ["-fprofile-instr-generate", "-fcoverage-mapping"]
    : []),
  ...(process.platform === "darwin" ? ["-stdlib=libc++"] : []),
  `-I${includeRoot}`,
  `-I${path.join(cppDir, "core")}`,
  `-I${path.join(cppDir, "bindings")}`,
  `-I${generatedDir}`,
];
const linkFlags = [
  ...(sanitizers ? [`-fsanitize=${sanitizers}`] : []),
  ...(process.platform === "darwin" ? [] : ["-lpthread"]),
];

function resolveLlvmTool(name) {
  if (process.platform !== "darwin") {
    return name;
  }
  return execFileSync("xcrun", ["--find", name], { encoding: "utf8" }).trim();
}

function runCommand(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    ...options,
  });
}

function sanitizerRuntimeEnv() {
  if (!sanitizers) {
    return process.env;
  }

  if (sanitizers.includes("address")) {
    return {
      ...process.env,
      ASAN_OPTIONS: process.env.ASAN_OPTIONS ?? "strict_string_checks=1",
    };
  }

  if (sanitizers.includes("undefined")) {
    return {
      ...process.env,
      UBSAN_OPTIONS:
        process.env.UBSAN_OPTIONS ?? "halt_on_error=1:print_stacktrace=1",
    };
  }

  return process.env;
}

function runCoverage() {
  const profile = path.join(buildDir, "coverage.profraw");
  const mergedProfile = path.join(buildDir, "coverage.profdata");
  const exportFile = path.join(buildDir, "coverage-summary.json");
  const profdata = resolveLlvmTool("llvm-profdata");
  const cov = resolveLlvmTool("llvm-cov");

  runCommand(outputFile, [], {
    env: { ...process.env, LLVM_PROFILE_FILE: profile },
  });

  runCommand(profdata, ["merge", "-sparse", profile, "-o", mergedProfile]);

  runCommand(cov, [
    "report",
    outputFile,
    `-instr-profile=${mergedProfile}`,
    ...coverageSources,
  ]);

  const exportSummary = execFileSync(
    cov,
    [
      "export",
      outputFile,
      `-instr-profile=${mergedProfile}`,
      "-summary-only",
      ...coverageSources,
    ],
    { encoding: "utf8" },
  );
  fs.writeFileSync(exportFile, exportSummary);

  const readMinArg = (name, fallback) => {
    const arg = process.argv.find((value) => value.startsWith(`--min-${name}=`));
    return arg ? Number(arg.split("=")[1]) : fallback;
  };

  const summary = JSON.parse(fs.readFileSync(exportFile, "utf8"));
  const totals = summary.data[0].totals;
  const thresholds = {
    lines: readMinArg("lines", 70),
    functions: readMinArg("functions", 82),
    regions: readMinArg("regions", 65),
    branches: readMinArg("branches", 50),
  };
  const actual = {
    lines: totals.lines.percent,
    functions: totals.functions.percent,
    regions: totals.regions.percent,
    branches: totals.branches.percent,
  };
  const failures = Object.entries(thresholds).filter(
    ([metric, threshold]) => actual[metric] < threshold,
  );

  if (failures.length > 0) {
    failures.forEach(([metric, threshold]) => {
      console.error(
        `❌ C++ ${metric} coverage ${actual[metric].toFixed(2)}% is below ${threshold}%`,
      );
    });
    process.exit(1);
  }

  console.log(
    `✅ C++ coverage passed: lines ${actual.lines.toFixed(2)}%, functions ${actual.functions.toFixed(2)}%, regions ${actual.regions.toFixed(2)}%, branches ${actual.branches.toFixed(2)}%`,
  );
}

try {
  runCommand("clang++", [
    ...commonFlags,
    testFile,
    contextSource,
    storageSource,
    workerSource,
    segmentStoreSource,
    contextSpec,
    storageSpec,
    workerSpec,
    "-o",
    outputFile,
    ...linkFlags,
  ]);

  if (coverageEnabled) {
    runCoverage();
  } else {
    runCommand(outputFile, [], { env: sanitizerRuntimeEnv() });
  }

  console.log("✅ C++ tests passed!");
} catch {
  console.error("❌ C++ tests failed.");
  process.exit(1);
}
