# react-native-nitro-amplitude

[![npm version](https://img.shields.io/npm/v/react-native-nitro-amplitude?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![npm downloads](https://img.shields.io/npm/dm/react-native-nitro-amplitude?color=22c55e&label=downloads)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![CI](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/actions/workflows/ci.yml/badge.svg)](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-nitro-amplitude?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-0.86.3-61dafb)](https://reactnative.dev/docs/0.86/getting-started-without-a-framework)
[![Expo](https://img.shields.io/badge/expo-SDK%2057%20%28RN%200.86.3%29-000020)](https://docs.expo.dev/versions/v57.0.0/)
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

Compatibility for `0.11.0`:

| Dependency                   | Supported range    | Tested baseline     |
| ---------------------------- | ------------------ | ------------------- |
| `react`                      | `>=18.2.0`         | `19.2.3`            |
| `react-native`               | `>=0.77`           | `0.86.3`            |
| `react-native-nitro-modules` | `>=0.37.0 <0.38.0` | `0.37.1`            |
| Expo development builds      | SDK `>=53`         | SDK 57 (`~57.0.27`) |

The package supports React Native `>=0.77` and Expo SDK `>=53`, the Nitro
Modules `0.37` minimum. It is tested on React Native `0.86.3` and Expo SDK 57.

The iOS deployment target follows React Native's `min_ios_version_supported`.

The package gate and example use React Native `0.86.3` with the Strict
TypeScript API. `check:ci` also compiles the public source against React Native
`0.87.0`'s Strict TypeScript API; this is a source type check, not the runtime
baseline. Expo SDK 57 manages React Native `0.86.3`; do not override it in an
Expo app.

### Upgrade from 0.7.x and earlier

The `0.8.x`, `0.9.x`, `0.10.x`, and `0.11.x` lines keep the native peer boundary introduced in `0.7.0`:
`react-native-nitro-amplitude` requires `react-native-nitro-modules`
`>=0.37.0 <0.38.0`. Upgrade the Nitro package together with this package, then
regenerate and rebuild native projects so the committed Nitro 0.37.1 bindings
are compiled into the app:

```sh
bun add react-native-nitro-amplitude@0.11.0 react-native-nitro-modules@0.37.1
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

iOS static frameworks are supported with source-built React Native. After
upgrading, regenerate the Expo native project or run `pod install`, then rebuild
the app so CocoaPods applies the updated header paths.

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

await amplitude.init({ user_id: "user-123" });
amplitude.analytics.track("Checkout Started", { source: "cart" });

await amplitude.experiment.fetch();
const enabled =
  amplitude.experiment.variant("enable-onboarding").value === "on";
```

`fetchOnStart: false` means the client does not fetch variants by itself. Call
`fetch()` (or `start()`) after `init()` and before you read `variant()`.
Without a fetch, `variant()` returns only cached or fallback values.

`durableStorage: false` skips the combined storage preset. It does not disable
the SDKs' default persistence. Supply `analytics.storageProvider`,
`analytics.cookieStorage`, and `experiment.storage` explicitly when the app
needs custom storage behavior. Singleton `init` / `track` / `identify` remain
available below.

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

### Upload timing

On iOS and Android, events are saved to native storage when they are tracked.
Uploads run in batches: every 30 seconds, when 30 events are queued, or when
the app moves to the background. This matches the Amplitude Swift and Kotlin
SDK defaults and keeps the radio idle between batches. Web keeps a 1 second
interval.

A `track(...).promise` resolves when its batch is uploaded. Do not await it on
a user interaction path. Call `flush()` when you need an upload now, for
example before sign-out:

```ts
await flush().promise;
```

To restore the previous 1 second upload interval on native:

```ts
await init("AMPLITUDE_API_KEY", undefined, {
  flushIntervalMillis: 1000,
}).promise;
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

Explicit user properties passed to `fetch` or `fetchOrThrow` take precedence
over properties supplied by an analytics user provider. Changing the explicit
user invalidates outstanding fetches and retries for the previous user. Separate
flag-key fetches for the same user can still retry. Call `setUser({})` and
`clear()` on logout before fetching assignments for another account. Clearing
invalidates outstanding fetches, stops retries, and orders the empty storage
write after earlier writes; it does not cancel HTTP transport already in progress.

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
`InMemoryStorage` are process-local only, and each instance keeps its own
data. The Experiment `LocalStorage` export (`ExperimentLocalStorage` from the
root entry) is memory-only and deprecated; use `NitroExperimentStorage` or the
durable storage preset for variants that must survive restarts. Persisted session state is plain
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
offline and re-enable it on reconnect, then call `flush()`. While the network
is disabled, analytics events stay queued in durable storage. Scheduled flushes
are skipped and do not count as retry attempts, so events are not dropped for
exceeding `flushMaxRetries`. Uploads resume on the next flush interval after
you re-enable the network, or at once when you call `flush()`. A `flush()` or
`flushWithResult()` call while the network is disabled resolves without
sending and reports the events as still queued. This applies to the package's
network transports (the default Nitro transport and the web fetch transport).
`DryRunTransport` and custom transports keep running. Experiment fetches reject
with `network_error` while the network is disabled.

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
  requests, 2 concurrent workers). POST/PUT bodies of at least 1 KiB to
  `amplitude.com` or its DNS subdomains are gzip-compressed on the worker thread.
  Custom hosts remain uncompressed, including hosts or paths that merely contain
  that text; malformed authorities and userinfo do not qualify.
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
failures. `error.code` stays a stable category and `error.message` stays the
bare native code (for example `network_error`), so grouping and deduplication
keep working. Classification does not depend on localized message text.
Native startup failures are also available through `getLastNativeError()` and
diagnostics. Do not expose raw error messages to end users without reviewing
them for application-specific sensitive data.

### Native transport detail

Native HTTP failures expose the exact native outcome on two extra fields:

- `error.nativeCode`: the native code, one of `network_error`, `timeout`,
  `invalid_url`, `invalid_http_response`, `cancelled`, `queue_full`, or
  `native_http_exception`. All except `timeout` keep
  `error.code` as `network_error`; use `nativeCode` to tell them apart.
- `error.details`: OS-level detail for `network_error`, when the platform
  reports it. iOS sets `domain`, `code` (an `NSURLError` code such as `-1003`),
  and `description`. Android sets `exception` (the exception class, such as
  `java.net.UnknownHostException`) and `description`. `details` is `undefined`
  for other native codes.
- `error.cause`: an `Error` whose message is the raw native string.

```ts
try {
  await experiment.fetchOrThrow();
} catch (error) {
  if (error instanceof AmplitudeError && error.details) {
    report({
      code: error.code,
      nativeCode: error.nativeCode,
      domain: error.details.domain,
      osCode: error.details.code,
      exception: error.details.exception,
    });
  }
}
```

`description` is the platform's own text, capped at 200 characters, with `|`,
line breaks, URL query strings, URL credentials, credential-like values, long
token-like strings, and local socket addresses (` from /<address> (port N)`)
removed. The remote hostname is kept. IPv4 and IPv6 addresses are replaced with
`[ip]`. It is not
localized or stable across OS versions. Group on `nativeCode`, `domain`,
`code`, and `exception`, not on `description`.

`getDiagnostics().diagnosticFailures[].kind` uses the same detail. Besides
`network_error`, `timeout`, `dns_or_hostname_resolution`, and `http_status`, it
can report `offline` (`-1009`, or an unreachable network on Android),
`connect_failed` (`-1004`, `ConnectException`), `connection_lost` (`-1005`,
`SocketException`, `EOFException`), and `tls_failure` (`-1200` to `-1206`,
`-2000`, `SSLException` and certificate exceptions). DNS covers `-1003`,
`-1006`, and `UnknownHostException`.

Offline detection differs by platform. iOS reports `-1009` (`offline`). Android
usually reports an `UnknownHostException` when the device has no connection, so
it surfaces as `dns_or_hostname_resolution`; `offline` appears on Android only
for an `ENETUNREACH` or "network is unreachable" `ConnectException`.

### Transport behavior

- `fetchTimeoutMillis` (default `10000`) starts when a native worker begins
  the request. Time spent waiting in the native queue is not counted.
- The native worker runs 2 requests at a time. Analytics uploads and Experiment
  fetches share it, so a burst of uploads can delay a fetch before its timeout
  starts.
- iOS also stops waiting after `fetchTimeoutMillis + 5000` ms and reports
  `timeout`, even if `URLSession` has not finished.
- The worker caps any timeout at 300000 ms.

### Replace the Experiment HTTP client

Pass `httpClient` to route Experiment fetches through your own transport, for
example the platform `fetch`, to compare it with the native client:

```ts
import { Experiment } from "react-native-nitro-amplitude";

const httpClient = {
  async request(url, method, headers, data, timeoutMillis = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMillis);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: data ?? undefined,
        signal: controller.signal,
      });
      return { status: response.status, body: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  },
};

const experiment = Experiment.initialize("EXPERIMENT_DEPLOYMENT_KEY", {
  httpClient,
});
```

The default is the Nitro HTTP client (browser `fetch` on web). A custom client
bypasses the native worker, so `nativeCode` and `details` are not set on its
errors; diagnostics classify them from the error message.

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
  `LocalStorage`, `MemoryStorage`, `InMemoryStorage`). `nitroHttpClient`
  limits: response bodies are cut at 4 MiB with the status code kept, `GET`
  and `HEAD` are sent without a body, and `PATCH` and custom methods are not
  supported on Android. The native upload queue holds at most 100 requests
  and 64 MiB; above that a request completes with `queue_full`.
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
- [Native libraries](docs/native-libraries.md) — gzip transport and JSONL
  tombstones; rejected encode/queue replacements.
- [Benchmark methodology](docs/benchmarks.md) — isolated local transport gate
  and its limits.

## Platform Support

| Platform | Behavior                                                                   |
| -------- | -------------------------------------------------------------------------- |
| iOS      | Native Nitro context, storage, and HTTP worker; pods and rebuild required. |
| Android  | Native Nitro context, storage, and package-owned context initializer.      |
| Web      | Browser fetch and storage fallbacks; no native plugin required.            |
| Expo     | SDK 53+ development builds with the config plugin (tested on SDK 57).      |
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
- Native event persistence is coalesced for throughput. Pending writes are
  flushed when the app becomes inactive or enters the background, and by
  explicit flush calls. Await `analytics.flushWithResult()` and inspect its
  result when the app needs to observe completion or handle a failure.
  Queued or retried events are not confirmed uploads. `shutdown()` starts an
  asynchronous flush and teardown, returns `void`, and cannot be awaited as
  a completion boundary.
- For typed Experiment variant payloads, prefer the typed variant helpers
  exported from the package (`react-native-nitro-amplitude/experiment`) over
  reading the untyped `variant.payload` directly.

### Browser storage failure behavior

Failed localStorage writes and removals remain visible through shared in-process overrides. A namespace reset prevents older durable values from reappearing after access recovers. Successful durable reads can observe external changes; denied reads use the last locally written value. If namespace reset cannot enumerate or remove durable keys, its in-process tombstone also hides later cross-tab writes until a successful explicit reset or a local write for that key. Browser storage events cannot prove that an event queued before reset contains fresh data, so this failure path keeps the namespace hidden. These fallbacks do not promise persistence across a page reload when browser storage rejects writes.

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

For deterministic smoke checks, start Metro with `bun run example:start:fixture`
in one terminal, launch the installed example, then run
`bun run example:smoke:fixture` in another. The flow requires the rendered
`dry-run fixture` marker before performing analytics actions; setting an
environment variable only for Maestro does not change an existing bundle.

The maintained Agent Device replay covers Analytics, Experiment, diagnostics,
native HTTP and the default native Analytics transport against a local fixture,
and storage and identity across an app relaunch. Build
the example with `EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1`, start the local HTTP fixture,
then select the exact installed target:

```sh
bun run example:replay --platform ios --udid <UDID> --http-fixture-url http://127.0.0.1:4318
bun run example:replay --platform android --serial <SERIAL> --http-fixture-url http://10.0.2.2:4318
```

Use a fixture address reachable from the selected device. The replay checks
the rendered fixture marker before exercising its APIs. Live provider checks
remain separate and require staging credentials and account-side evidence.
See the [replay guide](docs/qa/agent-device-replay.md) for fixture setup,
coverage, artifact locations, and flow maintenance. `bun run check` includes
the device-free replay freshness check; it does not execute a device replay.

## License

MIT
