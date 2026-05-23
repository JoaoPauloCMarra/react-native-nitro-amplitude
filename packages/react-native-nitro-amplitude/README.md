# react-native-nitro-amplitude

[![version](https://img.shields.io/badge/version-0.5.0-blue)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/license/mit)
[![React Native](https://img.shields.io/badge/react--native-%3E%3D0.75-61dafb)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/expo-SDK%2056-000020)](https://expo.dev/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.35.7-black)](https://nitro.margelo.com/)

Amplitude Analytics and Experiment for React Native in one Nitro package.

The public API is aligned with `amplitude-rn-analytics` and
`amplitude-rn-experiment`, while iOS and Android use Nitro Modules for native
context, storage, and background HTTP transport. Web builds use the package's
`index.web.ts` entrypoint with browser fetch and storage fallbacks.

## Features

- Analytics client methods including `init`, `track`, `identify`, `flush`,
  `reset`, `shutdown`, and `createInstance`.
- Experiment client methods including `Experiment.initialize`,
  `Experiment.initializeWithAmplitudeAnalytics`, `start`, `fetch`, `variant`,
  and `exposure`.
- Compatibility subpaths for incremental migration:
  `react-native-nitro-amplitude/analytics` and
  `react-native-nitro-amplitude/experiment`.
- Native `AmplitudeContext`, `AmplitudeStorage`, and `AmplitudeWorker`
  HybridObjects on iOS and Android.
- Web-compatible Analytics and Experiment entrypoints without native Nitro
  requirements.
- Expo config plugin and deterministic example app smoke tests.

## Install

```sh
bun add react-native-nitro-amplitude "react-native-nitro-modules@>=0.35.7"
```

Peer dependencies:

- `react >=18.2.0`
- `react-native >=0.75.0`
- `react-native-nitro-modules >=0.35.7`

For Expo SDK 56:

```sh
bunx expo install react-native-nitro-amplitude react-native-nitro-modules
```

Add the config plugin for native iOS and Android builds:

```json
{
  "expo": {
    "plugins": ["react-native-nitro-amplitude"]
  }
}
```

Then prebuild or rebuild your native app:

```sh
bunx expo prebuild
```

Web-only apps do not need the config plugin.

## Analytics

```ts
import {
  Identify,
  flush,
  identify,
  init,
  track,
} from "react-native-nitro-amplitude";

await init("AMPLITUDE_API_KEY", "user-id", {
  instanceName: "$default_instance",
  trackingSessionEvents: true,
}).promise;

track("button_clicked", { screen: "home" });

const update = new Identify();
update.set("plan", "pro");
identify(update);

await flush().promise;
```

Use named instances when one app needs separate Analytics clients:

```ts
import { createInstance } from "react-native-nitro-amplitude";

const analytics = createInstance();

await analytics.init("AMPLITUDE_API_KEY", "user-id", {
  instanceName: "checkout",
}).promise;

analytics.track("checkout_started");
```

## Experiment

```ts
import { Experiment, init } from "react-native-nitro-amplitude";

const instanceName = "main";

await init("AMPLITUDE_ANALYTICS_API_KEY", "demo-user", {
  instanceName,
}).promise;

const experiment = Experiment.initializeWithAmplitudeAnalytics(
  "AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY",
  {
    instanceName,
    automaticExposureTracking: true,
  },
);

await experiment.fetch();

const variant = experiment.variant("demo-flag");

if (variant.value === "on") {
  showEnabledExperience();
}
```

Use `Experiment.initialize` when the Experiment client should not read identity
from an Analytics instance:

```ts
import { Experiment } from "react-native-nitro-amplitude";

const experiment = Experiment.initialize("AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY");

await experiment.fetch({
  user_id: "demo-user",
  device_id: "device-id",
});
```

## Durable storage preset

The package works without app configuration, but production apps usually want
Analytics queue storage, Analytics session storage, and Experiment variant
storage to survive restarts together:

```ts
import {
  Experiment,
  createDurableAmplitudeStoragePreset,
  init,
} from "react-native-nitro-amplitude";

const storage = createDurableAmplitudeStoragePreset({ namespace: "main" });

await init("AMPLITUDE_API_KEY", "user-id", {
  instanceName: "main",
  ...storage.analytics,
}).promise;

const experiment = Experiment.initializeWithAmplitudeAnalytics(
  "AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY",
  {
    instanceName: "main",
    ...storage.experiment,
  },
);
```

| State                          | Default                                   | Durable preset                          |
| ------------------------------ | ----------------------------------------- | --------------------------------------- |
| Analytics event queue          | Nitro-backed event storage                | Nitro-backed event storage              |
| Analytics session/cookie state | React Native local storage fallback       | Nitro-backed session storage            |
| User ID and device ID          | Stored in session/cookie state after init | Stored in Nitro-backed session storage  |
| Experiment variants            | Nitro memory storage by default           | Nitro-backed persistent variant storage |
| Exposure dedupe state          | In memory per Experiment client session   | In memory per Experiment client session |

`createPersistentAmplitudeConfig()` is an alias for the same preset. The
namespace isolates multiple app environments and instances.

## Combined client

Use `createAmplitudeClient` when Analytics and Experiment should share instance
name, identity, device ID, durable storage, and dry-run options:

```ts
import { createAmplitudeClient } from "react-native-nitro-amplitude";

const amplitude = createAmplitudeClient({
  analyticsApiKey: "AMPLITUDE_API_KEY",
  experimentDeploymentKey: "AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY",
  instanceName: "main",
  userId: "user-id",
  durableStorage: true,
});

await amplitude.init();
await amplitude.experiment.fetch();
const variant = amplitude.experiment.variant("checkout-copy");
```

When `Experiment.initializeWithAmplitudeAnalytics` or `createAmplitudeClient`
uses the same `instanceName` as Analytics, the Experiment user provider reads
the Analytics user ID and device ID through Amplitude's connector. Multiple
Analytics instances are isolated by `instanceName`. TypeScript treats
`amplitude.experiment` as required when `experimentDeploymentKey` is present and
optional when the combined client is Analytics-only.

## Diagnostics and health checks

```ts
import {
  getDiagnostics,
  getLastNativeError,
  healthCheck,
} from "react-native-nitro-amplitude";

const diagnostics = getDiagnostics();
const health = await healthCheck();
const lastNativeError = getLastNativeError();
```

Diagnostics expose initialized state, queue size, last flush time, last flush
duration, last flush error, user ID, device ID, session ID, active instance
names, network-enabled state, native HybridObject availability, and storage
writability. On native, `healthCheck()` verifies that native bindings can be
reached and storage can round-trip a value. On web, diagnostics intentionally
report `nativeAvailable: false` while browser fetch and storage fallbacks remain
usable.

Structured errors use stable codes: `not_initialized`, `network_error`,
`storage_error`, `invalid_api_key`, `invalid_deployment_key`,
`experiment_fetch_failed`, `native_unavailable`, `serialization_error`,
`event_too_large`, `timeout`, and `unknown`.

## Network controls and dry-run transport

```ts
import {
  clearDryRunTransportRecords,
  dryRunHttpClient,
  dryRunTransport,
  getDryRunTransportRecords,
  setNetworkEnabled,
} from "react-native-nitro-amplitude";

setNetworkEnabled(false);
clearDryRunTransportRecords();

await init("AMPLITUDE_API_KEY", "benchmark-user", {
  transportProvider: dryRunTransport,
}).promise;

const experiment = Experiment.initialize("DEPLOYMENT_KEY", {
  httpClient: dryRunHttpClient,
});

const captured = getDryRunTransportRecords();
```

Use dry-run transport for QA screens, test runs, and benchmark-safe validation.
For side-by-side benchmarks, do not point both SDKs at production projects.
Either use dry-run transport or isolated Amplitude dev/benchmark projects.

## Request timing and performance debugging

Use the timing wrappers to split slow paths into HTTP time and app/package code
time without changing native code:

```ts
import {
  createNetworkTimingBuffer,
  createTimedAnalyticsTransport,
  createTimedHttpClient,
  init,
  nitroHttpClient,
  nitroTransport,
  Experiment,
} from "react-native-nitro-amplitude";

const timings = createNetworkTimingBuffer(20);

await init("AMPLITUDE_API_KEY", "user-id", {
  transportProvider: createTimedAnalyticsTransport(
    nitroTransport,
    timings.record,
  ),
}).promise;

const experiment = Experiment.initialize("DEPLOYMENT_KEY", {
  httpClient: createTimedHttpClient(nitroHttpClient, timings.record),
});

console.log(timings.getTimings());
```

For Analytics, `track()` measures queue/code execution and `flushWithResult()`
is the request-backed path. For Experiment, `fetchWithMetadata()` is the
request-backed path and `variantWithMetadata()` measures cached variant
resolution plus exposure enqueue behavior. The example app shows both the last
request and a bounded request history so slow runs can be compared directly.

## Flush and fetch metadata

`flushWithResult()` returns sent, failed, dropped, retried, and reason fields
around the underlying Analytics flush result.

`experiment.fetchWithMetadata()` returns fetched flag keys, cache hit status,
duration, source, and failure reason. `variantWithMetadata()` returns the
variant, source, fallback status, stale status, and fallback/failure reason.
Repeated simultaneous Experiment fetches are deduplicated by sharing the
in-flight request.

```ts
const flush = await flushWithResult();
const fetch = await experiment.fetchWithMetadata(undefined, {
  flagKeys: ["checkout-copy"],
});
const variant = experiment.variantWithMetadata("checkout-copy", "control");
```

`clearVariants()` clears cached variants without resetting Analytics identity.
`hasCachedVariant(flagKey)` checks whether a flag currently has a cached
variant.

## Experiment behavior

`fetch()` contacts Amplitude Experiment and stores returned variants. `variant()`
reads from the configured source and, when `automaticExposureTracking` is true,
sends an exposure through the configured exposure provider. `exposure()` sends
an exposure explicitly for a previously resolved key. `fetch()` does not send
exposures by itself.

If no exposure provider is configured, exposure calls are no-ops. The provider
is configured automatically when using
`Experiment.initializeWithAmplitudeAnalytics`.

Typed helpers are available for common flag shapes:

```ts
import {
  variantBoolean,
  variantJson,
  variantNumber,
  variantPayload,
  variantString,
} from "react-native-nitro-amplitude";

const enabled = variantBoolean(experiment, "new-flow", false);
const label = variantString(experiment, "button-label", "Continue");
const limit = variantNumber(experiment, "max-items", 10);
const config = variantJson(experiment, "layout-json", { columns: 1 });
const payload = variantPayload(experiment, "payload-flag", { color: "blue" });
```

## Privacy, lifecycle, and identity recipes

Use `setOptOut(true)` to stop tracking, `reset()` to clear Analytics user ID and
rotate the device ID, and the durable storage preset `clear()` helper to clear
package-managed persisted state for a namespace.

Recommended sign-out sequence:

1. `await flushWithResult()`
2. `experiment.clearVariants()`
3. `reset()`
4. `setUserId(undefined)`
5. Clear app-owned user properties and app-owned experiment state

Recommended user switch sequence:

1. `await flushWithResult()` for the previous user
2. `experiment.clearVariants()`
3. `setUserId(nextUserId)`
4. `await experiment.fetch({ user_id: nextUserId })`
5. Render the first screen that depends on Experiment assignments

Consent-gated apps should wait to call `init()` until consent is granted. To
avoid pre-consent network traffic in test or privacy states, call
`setNetworkEnabled(false)` before initialization and use dry-run transport.

Client keys and deployment keys are not server secrets, but they should be
environment-specific and excluded from logs. Diagnostics intentionally expose
state shape and status rather than event property values.

## Native rebuild and Expo plugin

Installing the package changes native code. Metro reload is not enough. Rebuild
or prebuild the native app after installation, Nitro version changes, config
plugin changes, or React Native upgrades.

The Expo config plugin injects Android application context setup required by the
native Analytics adapter and lets Expo autolinking include the Nitro module.
After `bunx expo prebuild`, verify:

- Android `MainApplication.onCreate` calls `AndroidAmplitudeAdapter.setContext`.
- iOS Pods include `react-native-nitro-amplitude`.
- The app launches without a `NitroModules.createHybridObject` failure.
- `healthCheck()` reports `nativeAvailable: true`.

For Expo Doctor, this package may not appear in React Native Directory checks.
Exclude it from directory validation if your app enforces that check.

## Compatibility imports

The root entry exports Analytics and Experiment APIs for new code:

```ts
import { Experiment, init, track } from "react-native-nitro-amplitude";
```

For migrations from the original packages, use the compatibility subpaths:

```ts
import { init, track } from "react-native-nitro-amplitude/analytics";
import { Experiment } from "react-native-nitro-amplitude/experiment";
```

`react-native-nitro-amplitude/analytics` mirrors the public entrypoint shape of
`amplitude-rn-analytics`. `react-native-nitro-amplitude/experiment` mirrors the
public entrypoint shape of `amplitude-rn-experiment`.

Import app-facing APIs from the root package unless you are preserving old
import paths during a migration. The `/analytics` and `/experiment` subpaths are
stable compatibility paths. Do not import from `src`, `lib`, `native`, or other
private package internals.

## TypeScript

The package ships generated declaration files and re-exports the public
Analytics and Experiment types used by the implementation:

```ts
import type {
  AmplitudeNetworkTimingBuffer,
  ExperimentConfig,
  ExperimentFetchResult,
  ExperimentVariantResult,
  Logger,
  Variant,
} from "react-native-nitro-amplitude";
import { createNetworkTimingBuffer } from "react-native-nitro-amplitude";
import type { ReactNativeOptions } from "react-native-nitro-amplitude/analytics";

const analyticsOptions = {
  instanceName: "main",
  trackingSessionEvents: true,
} satisfies ReactNativeOptions;

const experimentConfig = {
  instanceName: "main",
  automaticExposureTracking: true,
  serverZone: "US",
} satisfies ExperimentConfig;

const lastTimings: AmplitudeNetworkTimingBuffer = createNetworkTimingBuffer(20);

function handleFetchResult(result: ExperimentFetchResult): void {
  const failureReason = result.fetched ? undefined : result.failureReason;
  void failureReason;
}

function handleVariantResult(result: ExperimentVariantResult): Variant {
  return result.variant;
}
```

Prefer `satisfies` for configuration objects so TypeScript keeps literal values
while still checking option names and value types. The root package also
exports structured result and diagnostics types such as
`AmplitudeDiagnostics`, `AmplitudeErrorCode`, `AmplitudeNetworkTiming`,
`AmplitudeNetworkTimingBuffer`, `ExperimentFetchResult`, and
`ExperimentVariantResult` so app code can avoid stringly typed wrappers.

Test helpers are typed and can be imported from the root package:

```ts
import {
  createFakeExperimentStorage,
  createMockAmplitudeClient,
  createMockExperimentClient,
} from "react-native-nitro-amplitude";
```

The package's CI validates strict public types, documented root exports,
compatibility subpaths, and representative README examples through type tests
and import smoke tests.

## Web

The root entrypoint and both compatibility subpaths are available on web:

```ts
import { Experiment, init, track } from "react-native-nitro-amplitude";
```

Web builds use browser `fetch`, `localStorage`, `sessionStorage`, and in-memory
fallbacks instead of Nitro HybridObjects. Native-only types such as
`AmplitudeWorker` remain available for TypeScript compatibility, but no Nitro
native module is loaded on web.

## Native HybridObjects

| Object             | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `AmplitudeContext` | Device context and legacy SDK migration hooks   |
| `AmplitudeStorage` | Memory and disk KV for analytics/experiment     |
| `AmplitudeWorker`  | Background HTTP queue for upload/fetch requests |

If Nitro bindings are unavailable, rebuild the native app. Typical causes are a
missing prebuild, Pods not installed, Gradle cache using an old native project,
Hermes/New Architecture mismatch, or a Nitro Modules peer version mismatch.

## Platform support

| Platform | Analytics | Experiment | Native Nitro |
| -------- | --------- | ---------- | ------------ |
| iOS      | Yes       | Yes        | Yes          |
| Android  | Yes       | Yes        | Yes          |
| Web      | Yes       | Yes        | No           |

The package targets Hermes and the React Native New Architecture through Nitro
Modules. Tested release lanes use React Native 0.85, Expo SDK 56, Nitro Modules
0.35.7, Xcode 26, iOS 18+, Android Gradle Plugin from the Expo SDK 56 template,
and Android minSdk from the example template. Older RN versions are allowed by
peer range but should be validated in the consuming app.

Android ships consumer R8 rules with the package. iOS and Android release
builds should be part of app-level release validation when Analytics or
Experiment behavior is release-critical.

## Troubleshooting

- `Nitro module not found`: rebuild native projects, reinstall Pods, clean
  Gradle/CMake outputs, and confirm `react-native-nitro-modules` peer version.
- No events in dashboard: check API key, server zone, opt-out state, network
  state, flush result, and whether dry-run transport is configured.
- Experiment fetch returns no variant: check deployment key, flag key, user ID,
  device ID, server zone, and `fetchWithMetadata()` failure reason.
- Missing deployment key: validate configuration before app startup and avoid
  falling back to production keys in development.
- Hermes issues: confirm the app is rebuilt after installing Nitro Modules and
  that the native module is present in the generated app.
- Pods or Gradle failures: run clean prebuild, reinstall Pods, and inspect the
  package-owned `app.plugin.js`, podspec, Gradle, CMake, and generated Nitro
  files first.

## Production checklist

- Use separate Analytics API keys and Experiment deployment keys for dev,
  staging, benchmark, and production.
- Choose US or EU server zone consistently across Analytics and Experiment.
- Configure durable storage if sessions, queued events, or variants must
  survive restarts.
- Define consent, opt-out, sign-out, user-switch, and local data clearing
  behavior before release.
- Verify Android debug, Android release, iOS debug, and iOS release builds.
- Confirm events, identify calls, Experiment fetches, variants, exposures, and
  flushes in Amplitude dashboards without logging keys or sensitive properties.
- Capture timing output for `track`, `flushWithResult`, `fetchWithMetadata`,
  `variantWithMetadata`, and exposure in the example app.
- Confirm slow paths are either HTTP latency or local code time before changing
  package internals.
- Capture `getDiagnostics()`, `healthCheck()`, package version, React Native
  version, platform, and redacted app config when reporting support issues.

## Known limitations

- Legacy Amplitude SDK SQLite migration hooks are stubbed.
- Exposure dedupe state is in memory for the current Experiment client session.
- Background uploads are not guaranteed after process suspension; flush on
  foreground/background transitions from app code when required.
- Event plan validation, reserved-property enforcement, event-size enforcement,
  custom proxy/base URL examples, and local fake Experiment server support are
  extension points rather than mandatory runtime behavior in this release.
- Tree shaking depends on the consuming bundler. Analytics-only apps should use
  root or `/analytics` imports consistently and validate bundle output in their
  own Metro setup.

## Benchmarks

Use dry-run transport or isolated benchmark projects so local measurements do
not pollute production Amplitude data. The repo benchmark gate is:

```sh
bun run benchmark
```

Native latency numbers depend on the device, build type, network, server zone,
and whether dry-run transport is used. Record cold start, repeated `track()`,
HTTP duration and total duration for `flushWithResult()`, HTTP duration and SDK
duration for `fetchWithMetadata()`, variant read latency, and exposure enqueue
latency separately for Android and iOS. Treat `createTimedAnalyticsTransport`
and `createTimedHttpClient` output as the first debug signal before profiling
native code.

## Development

From the repository root:

```sh
bun install
bun run check
bun run example:check
bun run audit:package
bun run publish-package:dry-run
```

Native example verification:

```sh
bun run example:prebuild:clean
bun run example:android
bun run example:ios
bun run example:smoke
```

Package invariants and release requirements live in `AGENTS.md` in this
repository.

## License

[MIT](https://opensource.org/license/mit)
