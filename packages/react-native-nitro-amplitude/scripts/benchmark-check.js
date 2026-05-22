#!/usr/bin/env node
/**
 * Lightweight sanity benchmark for Amplitude Nitro package exports.
 * Mocks native runtimes so Node can validate build artifacts without RN.
 */
const Module = require("module");
const path = require("path");
const fs = require("fs");

const packageRoot = path.join(__dirname, "..");
const entrypointPath = path.join(packageRoot, "lib", "commonjs", "index.js");

if (!fs.existsSync(entrypointPath)) {
  console.error("Benchmark setup failed: run `bun run build` first.");
  process.exit(1);
}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "react-native") {
    return {
      Platform: { OS: "ios", select: (options) => options.ios ?? options.default },
      NativeModules: {},
      AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
    };
  }

  if (request === "react-native-nitro-modules") {
    return {
      NitroModules: {
        createHybridObject: () => ({
          prefetch: () => {},
          getApplicationContextJson: () => "{}",
          getLegacySessionDataJson: () => "{}",
          getLegacyEventsJson: () => "[]",
          removeLegacyEvent: () => {},
          set: () => {},
          get: () => undefined,
          has: () => false,
          remove: () => {},
          getAllKeys: () => [],
          getBatch: () => [],
          removeBatch: () => {},
          enqueueRequest: () => {},
          cancelAll: () => {},
        }),
      },
    };
  }

  return originalLoad(request, parent, isMain);
};

let amplitudeModule;
try {
  amplitudeModule = require(entrypointPath);
} catch (error) {
  console.error("Benchmark setup failed: unable to load benchmark entrypoint.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  Module._load = originalLoad;
}

const { VERSION, prefetchNativeContext, Experiment } = amplitudeModule;

if (typeof VERSION !== "string" || VERSION.length === 0) {
  console.error("Benchmark failed: VERSION export missing.");
  process.exit(1);
}

if (typeof prefetchNativeContext !== "function") {
  console.error("Benchmark failed: prefetchNativeContext export missing.");
  process.exit(1);
}

if (!Experiment || typeof Experiment.initialize !== "function") {
  console.error("Benchmark failed: Experiment factory export missing.");
  process.exit(1);
}

prefetchNativeContext();

console.log(`✅ Amplitude benchmark passed (version ${VERSION}).`);
