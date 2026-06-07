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

const {
  prefetchNativeContext,
  Experiment,
  createNetworkTimingBuffer,
  createTimedAnalyticsTransport,
  createTimedHttpClient,
  dryRunHttpClient,
  dryRunTransport,
} = amplitudeModule;

if (typeof prefetchNativeContext !== "function") {
  console.error("Benchmark failed: prefetchNativeContext export missing.");
  process.exit(1);
}

if (!Experiment || typeof Experiment.initialize !== "function") {
  console.error("Benchmark failed: Experiment factory export missing.");
  process.exit(1);
}

if (
  typeof createNetworkTimingBuffer !== "function" ||
  typeof createTimedAnalyticsTransport !== "function" ||
  typeof createTimedHttpClient !== "function"
) {
  console.error("Benchmark failed: timing debug exports missing.");
  process.exit(1);
}

async function runTimingBenchmark() {
  const buffer = createNetworkTimingBuffer(25);
  const analyticsTransport = createTimedAnalyticsTransport(
    dryRunTransport,
    buffer.record,
  );
  const experimentHttpClient = createTimedHttpClient(
    dryRunHttpClient,
    buffer.record,
  );

  const startedAt = performance.now();
  for (let index = 0; index < 10; index += 1) {
    await analyticsTransport.send("https://example.com/events", {
      events: [{ event_type: "benchmark", event_properties: { index } }],
    });
    await experimentHttpClient.request(
      `https://example.com/variants?index=${index}`,
      "GET",
      {},
      null,
      1000,
    );
  }

  const elapsed = performance.now() - startedAt;
  const timings = buffer.getTimings();
  if (timings.length !== 20) {
    throw new Error(`expected 20 timing samples, got ${timings.length}`);
  }
  if (elapsed > 1000) {
    throw new Error(`dry-run benchmark exceeded 1000ms: ${elapsed.toFixed(1)}ms`);
  }
}

prefetchNativeContext();

runTimingBenchmark()
  .then(() => {
    console.log("✅ Amplitude benchmark passed.");
  })
  .catch((error) => {
    console.error("Benchmark failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
