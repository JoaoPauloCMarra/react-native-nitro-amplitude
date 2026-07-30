# react-native-nitro-amplitude

[![npm version](https://img.shields.io/npm/v/react-native-nitro-amplitude?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![npm downloads](https://img.shields.io/npm/dm/react-native-nitro-amplitude?color=22c55e&label=downloads)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![CI](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/actions/workflows/ci.yml/badge.svg)](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-nitro-amplitude?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-%3E%3D0.75-61dafb)](https://reactnative.dev/docs/0.86/getting-started-without-a-framework)
[![Expo](https://img.shields.io/badge/expo-SDK%2057-000020)](https://docs.expo.dev/versions/v57.0.0/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-0.36.x-black)](https://nitro.margelo.com/)
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

Compatibility for `0.5.5`:

| Dependency                   | Supported range    | `0.5.5` baseline |
| ---------------------------- | ------------------ | ---------------- |
| `react`                      | `>=18.2.0`         | `19.2.3`         |
| `react-native`               | `>=0.75.0`         | `0.86.2`         |
| `react-native-nitro-modules` | `>=0.36.4 <0.37.0` | `0.36.4`         |
| Expo development builds      | SDK 57             | `~57.0.9`        |

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

## Network Controls

```ts
import {
  enableDryRunTransport,
  getDiagnostics,
  getSafeDiagnostics,
  setNetworkEnabled,
} from "react-native-nitro-amplitude";

setNetworkEnabled(false);
enableDryRunTransport();

const diagnostics = getDiagnostics();
const sentrySafeDiagnostics = getSafeDiagnostics();
```

Use dry-run transport in examples and tests when you need track/flush behavior
without sending events to Amplitude.

For offline-aware apps, pair `setNetworkEnabled` with a connectivity listener
(for example `@react-native-community/netinfo`): disable the network while
offline and re-enable it on reconnect, then call `flush()`. Events queue in
durable Nitro storage while the network is disabled.

## Diagnostics

Main diagnostics fields include:

- Native context readiness.
- Storage backend readiness.
- `AmplitudeWorker` queue and transport state.
- Flush and fetch metadata.
- Request timing summaries for analytics and experiment calls.

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
failures. Native startup failures are also available through
`getLastNativeError()` and diagnostics. Do not expose raw error messages to end
users without reviewing them for application-specific sensitive data.

## API

Analytics exports:

- `init`, `track`, `identify`, `groupIdentify`, `setGroup`, `revenue`,
  `flush`, `reset`, `shutdown`, and `createInstance`.
- `Identify`, `Revenue`, and analytics `Types`.
- `nitroTransport`, `nitroHttpClient`, network controls, testing helpers, and
  diagnostics helpers.

Experiment exports:

- `Experiment.initialize` and `Experiment.initializeWithAmplitudeAnalytics`.
- `ExperimentClient`, `StubExperimentClient`, `Source`, `LogLevel`, storage
  types, exposure types, user types, and typed variant helpers.

Native HybridObject types:

- `AmplitudeContext`.
- `AmplitudeStorage`.
- `AmplitudeWorker`.

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
  directly, avoiding extra interop hops.
- Privacy stance: Android omits unavailable `carrier`, `idfv`, `adid`, and
  `appSetId` context fields even when requested via context options. Wire your
  own values through event enrichment if your app has consent to collect them.
- Web memory storage is shared across package instances in the same JavaScript
  process and isolated by namespace, matching native memory-storage semantics.
- Legacy Amplitude SDK SQLite migration is not implemented yet:
  `migrateLegacyData` restores no legacy data, and
  `getNativeStartupDiagnostics().legacyMigrationSupported` reports `false`.
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

Run native example builds before release when changing plugin, native, Nitro, or
packaging files.

## License

MIT
