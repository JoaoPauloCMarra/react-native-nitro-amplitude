# react-native-nitro-amplitude

[![npm version](https://img.shields.io/npm/v/react-native-nitro-amplitude?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![npm downloads](https://img.shields.io/npm/dm/react-native-nitro-amplitude?color=22c55e&label=downloads)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![CI](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/actions/workflows/ci.yml/badge.svg)](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-nitro-amplitude?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-0.86.2-61dafb)](https://reactnative.dev/docs/0.86/getting-started-without-a-framework)
[![Expo](https://img.shields.io/badge/expo-SDK%2057%20%28RN%200.86.2%29-000020)](https://docs.expo.dev/versions/v57.0.0/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.37.0%20%3C0.38.0-black)](https://nitro.margelo.com/)
[![TypeScript](https://img.shields.io/badge/typescript-6.0-3178c6)](https://www.typescriptlang.org/)

Amplitude Analytics and Amplitude Experiment for React Native and Expo in one
Nitro package.

Use it to replace `amplitude-rn-analytics` and `amplitude-rn-experiment` with a
single package that keeps familiar APIs, adds native storage/context/transport
through Nitro, and still works on web through fetch and storage fallbacks.

## Install

```sh
bun add react-native-nitro-amplitude react-native-nitro-modules
```

## Requirements and compatibility

Compatibility for `0.8.0`:

| Dependency                   | Supported range    | `0.8.0` baseline                          |
| ---------------------------- | ------------------ | ----------------------------------------- |
| `react`                      | `>=18.2.0`         | `19.2.3`                                  |
| `react-native`               | `>=0.75.0`         | `0.86.2` package and Expo SDK 57 baseline |
| `react-native-nitro-modules` | `>=0.37.0 <0.38.0` | `0.37.0`                                  |
| Expo development builds      | SDK 57             | `~57.0.16`                                |

The package gate and example use React Native `0.86.2` with the Strict
TypeScript API. `check:ci` also compiles the public source against React Native
`0.87.0`'s Strict TypeScript API; this is a declaration-compatibility check, not
the runtime baseline. Expo SDK 57 manages React Native `0.86.2`; do not
override it in an Expo app.

### Upgrade from 0.7.x and earlier

The `0.8.x` line keeps the native peer boundary introduced in `0.7.0`:
`react-native-nitro-amplitude` requires `react-native-nitro-modules`
`>=0.37.0 <0.38.0`. Upgrade the Nitro package together with this package, then
regenerate and rebuild native projects so the committed Nitro 0.37.0 bindings
are compiled into the app:

```sh
bun add react-native-nitro-amplitude@0.8.0 react-native-nitro-modules@0.37.0
bunx expo prebuild
```

For bare iOS apps, run `pod install` after the dependency update. Expo Go does
not support this native module.

For Expo development builds:

```sh
bunx expo install react-native-nitro-amplitude react-native-nitro-modules
bunx expo prebuild
```

Expo Go cannot load Nitro native modules. Use an Expo development build or a
bare app. Rebuild native apps after installing or upgrading this package. Bare
iOS apps must also install pods:

```sh
cd ios
pod install
```

## Expo Config

Add the plugin before prebuilding native iOS and Android apps:

```json
{
  "expo": {
    "plugins": ["react-native-nitro-amplitude"]
  }
}
```

Android context setup is owned by the package. Native apps receive an Android
manifest initializer, and the Expo plugin is kept as the package registration
point for CNG projects. Apps should not edit `MainApplication` to call
`AndroidAmplitudeAdapter.setContext(this)`.

## Quick Start

Use `createAmplitudeClient` with a durable storage namespace. This replaces
hand-rolled analytics and experiment `Storage` adapters.

```ts
import { createAmplitudeClient, Source } from "react-native-nitro-amplitude";

const amplitude = createAmplitudeClient({
  analyticsApiKey: "AMPLITUDE_API_KEY",
  experimentDeploymentKey: "DEPLOYMENT_KEY",
  durableStorage: { namespace: "myapp" },
  experiment: {
    source: Source.LocalStorage,
    fetchOnStart: false,
  },
});

await amplitude.init();
amplitude.analytics.track("Checkout Started", { source: "cart" });
const enabled =
  amplitude.experiment.variant("enable-onboarding").value === "on";
```

Pass `durableStorage: false` only when the app must supply its own storage
adapters. Singleton `init` / `track` / `identify` remain available below.

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
}).promise;

track("Checkout Started", {
  source: "cart",
});

const user = new Identify();
user.set("plan", "pro");
identify(user);

await flush().promise;
```

Compatibility import:

```ts
import { init, track } from "react-native-nitro-amplitude/analytics";
```

### Screen tracking

Clients created with `createInstance()` expose the current Amplitude
screen-view contract:

```ts
import { createInstance } from "react-native-nitro-amplitude";

const analytics = createInstance();

analytics.trackScreenView("Checkout", {
  step: "payment",
});

analytics.trackScreenViewOnNavigationStateChange(navigationState);
```

Navigation-state tracking records the deepest active route and suppresses
consecutive duplicates. Reinitializing or shutting down the client resets that
deduplication state.

## Experiment

```ts
import {
  Experiment,
  Source,
  createPersistentAmplitudeConfig,
  init,
} from "react-native-nitro-amplitude";

const storage = createPersistentAmplitudeConfig("my-app");

await init("AMPLITUDE_API_KEY", "user-id", storage.analytics).promise;

const experiment = Experiment.initializeWithAmplitudeAnalytics(
  "EXPERIMENT_DEPLOYMENT_KEY",
  {
    ...storage.experiment,
    source: Source.LocalStorage,
    automaticExposureTracking: true,
  },
);

await experiment.start();
await experiment.fetch();

const variant = experiment.variant("checkout-copy");
```

Compatibility import:

```ts
import { Experiment } from "react-native-nitro-amplitude/experiment";
```

## Persistent Storage

```ts
import {
  createPersistentAmplitudeConfig,
  init,
} from "react-native-nitro-amplitude";

const storage = createPersistentAmplitudeConfig({
  namespace: "production",
});

await init("AMPLITUDE_API_KEY", undefined, {
  ...storage.analytics,
  sessionTimeout: 30 * 60 * 1000,
}).promise;
```

The preset stores analytics session state, device ID, user ID, and experiment
variants through the package storage layer. Use a different namespace per app,
environment, or test suite.

The default analytics session store is durable: device ID, user ID, and session
ID survive app restarts through the Nitro disk store on native and browser
localStorage on web. `LocalStorage` is the durable store; `MemoryStorage` /
`InMemoryStorage` are process-local only. Persisted session state is plain
text in the app sandbox; do not rely on it for secrets.

## Network Controls

```ts
import {
  getDiagnostics,
  getSafeDiagnostics,
} from "react-native-nitro-amplitude";
import {
  clearDryRunTransportRecords,
  DryRunHttpClient,
  DryRunTransport,
  setNetworkEnabled,
} from "react-native-nitro-amplitude/network";

setNetworkEnabled(false);

const dryRunTransport = new DryRunTransport();
const dryRunHttpClient = new DryRunHttpClient();
```

`DryRunTransport` and `DryRunHttpClient` record requests without sending them;
use `getDryRunTransportRecords()` and `getDryRunAnalyticsEvents()` in tests and
examples when you need track/flush behavior without events reaching Amplitude.
`clearDryRunTransportRecords()` resets the recorded requests and events.

For offline-aware apps, pair `setNetworkEnabled` with a connectivity listener
(for example `@react-native-community/netinfo`): disable the network while
offline and re-enable it on reconnect, then call `flush()`. Events queue in
durable Nitro storage while the network is disabled.

Network-control, dry-run record access, bounded timing helpers
(`createNetworkTimingBuffer`, `createTimedAnalyticsTransport`,
`createTimedHttpClient`), and their types live on the
`react-native-nitro-amplitude/network` subpath. The established root imports
remain compatible. Mock testing helpers
(`createMockAmplitudeClient`, `createMockExperimentClient`,
`createFakeExperimentStorage`) live on the `react-native-nitro-amplitude/testing`
subpath and remain available from the root for compatibility.

## Diagnostics

`getDiagnostics()` returns:

- Native readiness per capability: `contextAvailable`, `storageAvailable`,
  `workerAvailable`, and `nativeAvailable` are reported independently, so one
  failing module does not hide the others.
- `workerMetrics`: current `queueSize`, `inFlightCount`, and
  `pendingBodyBytes` from the native HTTP worker (bounded queue of 100
  requests, 2 concurrent workers).
- `networkTimings`: the bounded list of recent analytics and experiment
  request timings.
- Flush and fetch metadata plus `diagnosticFailures`.

`healthCheck()` probes the durable disk store and the worker alongside module
availability and returns `diskStorageWritable` and `workerReady`.

These APIs are for app health checks, support tooling, and release validation.
Do not send diagnostics that contain user identifiers to analytics or logs
without your own privacy review.

Analytics logging is disabled by default to keep transient retryable transport
failures out of React Native console capture tools. Pass `logLevel` or
`loggerProvider` to `init()` when an app needs Amplitude SDK logs.
`getDiagnostics().diagnosticFailures` still exposes sanitized failure state for
debugging, including operation, surface, failure kind, target host, HTTP status,
batch or queue counts, retry exhaustion, timestamp, throttled repeat count, and
package version. It never stores event payloads, API keys, user identifiers,
request bodies, or full URLs. Use `getSafeDiagnostics()` for Sentry breadcrumbs
or support snapshots that must omit user, device, and session identifiers.

Experiment uses durable Nitro storage by default for cached variants and flag
configuration. This keeps feature availability resilient when a later app launch
hits a transient DNS, timeout, or offline fetch failure. Pass a custom
`storage`, such as `NitroMemoryStorage`, only when process-local experiment
state is intentional.

## Error Handling

Use `AmplitudeError` and `getAmplitudeErrorCode()` when application behavior
depends on a stable error category:

```ts
import {
  AmplitudeError,
  getAmplitudeErrorCode,
} from "react-native-nitro-amplitude";

try {
  await experiment.fetch();
} catch (error) {
  const code = getAmplitudeErrorCode(error);

  if (error instanceof AmplitudeError) {
    console.warn(code, error.message);
  }
}
```

Error codes cover initialization, network, storage, credentials, Experiment
fetches, native availability, serialization, event size, timeouts, and unknown
failures. Native transport and storage failures carry stable machine-readable
codes (`invalid_url`, `timeout`, `network_error`, `invalid_http_response`,
`cancelled`, `queue_full`, `disk_adapter_unavailable`); classification does not
depend on localized message text. Native startup failures are also available
through `getLastNativeError()` and diagnostics. Do not expose raw error
messages to end users without reviewing them for application-specific
sensitive data.

## Experiment lifecycle and freshness

`Experiment.initialize` returns the existing singleton for a given instance
name and API key and ignores later configuration changes. Use
`Experiment.reinitialize(apiKey, config)` to replace an instance explicitly;
the previous instance is stopped first.

`variantWithMetadata()` reports a `freshness` state for variant data: `fresh`
after a successful fetch, `stale` when a fetch failure left cached data, and
`unknown` before any fetch outcome (initial variants, inline fallbacks, or
missing data). `stale: true` mirrors the `stale` freshness state.

`createAmplitudeClient(...).reset()` is a combined reset: it resets the
analytics identity (new device ID, cleared user ID) and clears the experiment
user and cached variants together.

## API

Analytics exports:

- `init`, `track`, `identify`, `groupIdentify`, `setGroup`, `revenue`,
  `flush`, `reset`, `shutdown`, `extendSession`, `flushWithResult`,
  `healthCheck`, and `createInstance`.
- `Identify`, `Revenue`, and analytics `Types`.
- `nitroTransport`, `nitroHttpClient`, storage adapters
  (`NitroAnalyticsStorage`, `NitroExperimentStorage`, `NitroMemoryStorage`,
  `LocalStorage`, `MemoryStorage`, `InMemoryStorage`).
- Network controls, dry-run record access, timing helpers, and mock helpers
  remain available from the root. Prefer the `/network` and `/testing`
  subpaths in new code.
- Diagnostics: `getDiagnostics`, `getSafeDiagnostics`,
  `getNativeStartupDiagnostics`, `getLastNativeError`, `healthCheck`,
  `clearDiagnosticFailures`, and worker metrics.

Experiment exports:

- `Experiment.initialize`, `Experiment.reinitialize`, and
  `Experiment.initializeWithAmplitudeAnalytics`.
- `ExperimentClient`, `StubExperimentClient`, `Source`, `LogLevel`, storage
  types, exposure types, user types, freshness types, and typed variant
  helpers.

Presets and combined client:

- `createDurableAmplitudeStoragePreset`, `createPersistentAmplitudeConfig`,
  `createAmplitudeClient`, `createExperimentUser`, `getConnectorIdentity`.

Native HybridObject types:

- `AmplitudeContext` (context JSON + prefetch, cached by normalized option
  set on both platforms). Its legacy session/event methods remain as deprecated
  no-op compatibility stubs; they do not import legacy Amplitude SQLite data.
- `AmplitudeStorage` (sync memory/disk KV with deprecated `setBatch`/`getBatch`
  wrappers and `removeBatch` for bulk cleanup).
- `AmplitudeWorker` (bounded queue, 2 concurrent workers, request-scoped
  completion, cancellation of queued requests, queue/in-flight/byte metrics).

## Documentation

- [API reference](docs/api-reference.md) — public exports and behavior.
- [Dependency policy](docs/dependency-policy.md) — supported Nitro, React
  Native, and Expo compatibility boundaries.
- [Benchmark methodology](docs/benchmarks.md) — isolated local transport gate
  and its limits.

## Platform Support

| Platform | Behavior                                                                   |
| -------- | -------------------------------------------------------------------------- |
| iOS      | Native Nitro context, storage, and HTTP worker; pods and rebuild required. |
| Android  | Native Nitro context, storage, and package-owned context initializer.      |
| Web      | Browser fetch and storage fallbacks; no native plugin required.            |
| Expo     | SDK 57 development builds with the config plugin.                          |
| Expo Go  | Unsupported because Expo Go cannot load custom Nitro modules.              |

Architecture notes:

- The native layer is a shared C++ core (Nitro HybridObjects) with thin
  platform adapters: Objective-C++ on iOS and Kotlin over JNI on Android.
  There is no Swift layer by design — the C++ core talks to platform APIs
  directly, avoiding extra interop hops. The adapter interface is split by
  capability (`ContextAdapter`, `StorageAdapter`, `HttpAdapter`) and the C++
  test gate runs contract tests against fake adapters.
- Privacy stance: Android omits unavailable `carrier`, `idfv`, `adid`, and
  `appSetId` context fields even when requested via context options. Wire your
  own values through event enrichment if your app has consent to collect them.
  Missing native context values are serialized as empty strings.
- Web context reports `platform`, `language`, and OS/device fields parsed from
  the user agent; `carrier`, `adid`, `appSetId`, and `idfv` are unavailable on
  web.
- Web memory storage is shared across package instances in the same JavaScript
  process and isolated by namespace, matching native memory-storage semantics.
- Legacy bridge methods are retained as deprecated no-op compatibility stubs.
  The `migrateLegacyData` option is also accepted as a no-op; this package does
  not import legacy Amplitude SDK SQLite data. Migrate that data before
  switching SDKs if it is required.
- Native event persistence is coalesced for throughput, but pending writes are
  flushed when the app becomes inactive or enters the background, and by
  explicit `flush()` or `shutdown()` calls. Use those methods before a process
  boundary when the app needs an immediate durability guarantee.
- For typed Experiment variant payloads, prefer the typed variant helpers
  exported from the package (`react-native-nitro-amplitude/experiment`) over
  reading the untyped `variant.payload` directly.

## Troubleshooting

- **Expo Go error:** build a dev client; Expo Go cannot load Nitro modules.
- **Events do not send:** check API keys, network controls, dry-run state, and
  `flush()` result metadata.
- **Experiment variant missing:** call `start()` or `fetch()` before `variant()`
  unless you intentionally rely on fallback variants.
- **Android context errors:** rebuild the native app after installing or
  upgrading the package so the Android manifest initializer is merged.
- **Native module unavailable:** verify `react-native-nitro-modules` satisfies
  the supported range, reinstall pods on iOS, then rebuild the app.

## Development

```sh
bun install
bun run check
bun run release:preflight
bun run example:android
bun run example:ios
```

Run native example builds locally before release when changing plugin, native,
Nitro, or packaging files. GitHub CI does not build the Android or iOS example.

## License

MIT
