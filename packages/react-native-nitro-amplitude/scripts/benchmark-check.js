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
const packageManifest = require(path.join(packageRoot, "package.json"));

if (packageManifest.name !== "react-native-nitro-amplitude") {
  console.error(
    `Benchmark setup failed: expected react-native-nitro-amplitude, got ${packageManifest.name}.`,
  );
  process.exit(1);
}

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
          set: () => {},
          get: () => undefined,
          has: () => false,
          remove: () => {},
          getAllKeys: () => [],
          getKeysByPrefix: () => [],
          removeBatch: () => {},
          enqueue: () => {},
          cancel: () => {},
          queueSize: () => 0,
          inFlightCount: () => 0,
          pendingBodyBytes: () => 0,
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

const { prefetchNativeContext, Experiment } = amplitudeModule;
const {
  createNetworkTimingBuffer,
  createTimedAnalyticsTransport,
  createTimedHttpClient,
  dryRunHttpClient,
  dryRunTransport,
} = require(path.join(packageRoot, "lib", "commonjs", "network.js"));

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

function percentile(values, percentileValue) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

async function runTimingSample() {
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
  return elapsed;
}

async function runTimingBenchmark() {
  const warmupSamples = 2;
  const measuredSamples = 8;

  prefetchNativeContext();
  for (let index = 0; index < warmupSamples; index += 1) {
    await runTimingSample();
  }

  const samples = [];
  for (let index = 0; index < measuredSamples; index += 1) {
    samples.push(await runTimingSample());
  }

  const totalMs = samples.reduce((sum, sample) => sum + sample, 0);
  const result = {
    package: packageManifest.name,
    version: packageManifest.version,
    benchmark: "dry-run-transport",
    scope: "node",
    native: false,
    network: false,
    operationsPerSample: 20,
    warmupSamples,
    measuredSamples,
    meanMs: totalMs / samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
  };

  if (result.p95Ms > 1000) {
    throw new Error(
      `dry-run benchmark p95 exceeded 1000ms: ${result.p95Ms.toFixed(1)}ms`,
    );
  }

  console.log(`Benchmark package: ${result.package}@${result.version}`);
  console.log(
    "Benchmark scope: isolated Node dry-run transport wrappers; no native SDK or network I/O.",
  );
  console.log(
    `Samples: ${result.measuredSamples} measured after ${result.warmupSamples} warmup samples; each sample performs ${result.operationsPerSample} operations.`,
  );
  console.log(
    `Timing: mean=${result.meanMs.toFixed(2)}ms p50=${result.p50Ms.toFixed(2)}ms p95=${result.p95Ms.toFixed(2)}ms`,
  );
  console.log(`BENCHMARK_RESULT ${JSON.stringify(result)}`);
}

runTimingBenchmark()
  .then(() => {
    console.log("✅ Amplitude isolated benchmark passed.");
  })
  .catch((error) => {
    console.error("Benchmark failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
