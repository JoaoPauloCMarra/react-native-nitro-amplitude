# react-native-nitro-amplitude

[![npm version](https://img.shields.io/npm/v/react-native-nitro-amplitude?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![license](https://img.shields.io/npm/l/react-native-nitro-amplitude?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-%3E%3D0.75-61dafb)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/expo-SDK%2056-000020)](https://expo.dev/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.35.7-black)](https://nitro.margelo.com/)

Amplitude Analytics and Amplitude Experiment for React Native and Expo in one
Nitro package.

Use it to replace `amplitude-rn-analytics` and `amplitude-rn-experiment` with a
single package that keeps familiar APIs, adds native storage/context/transport
through Nitro, and still works on web through fetch and storage fallbacks.

## Install

```sh
bun add react-native-nitro-amplitude react-native-nitro-modules
```

Peer dependencies:

| Package                      | Version    |
| ---------------------------- | ---------- |
| `react`                      | `>=18.2.0` |
| `react-native`               | `>=0.75.0` |
| `react-native-nitro-modules` | `>=0.35.7` |

For Expo development builds:

```sh
bunx expo install react-native-nitro-amplitude react-native-nitro-modules
bunx expo prebuild
```

Expo Go cannot load Nitro native modules. Use an Expo development build or a
bare app.

## Expo Config

Add the plugin before prebuilding native iOS and Android apps:

```json
{
  "expo": {
    "plugins": ["react-native-nitro-amplitude"]
  }
}
```

The plugin injects Android application context setup for the native
`AmplitudeContext`, `AmplitudeStorage`, and `AmplitudeWorker` HybridObjects.
Web-only apps do not need the plugin.

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

| Platform | Status                                          |
| -------- | ----------------------------------------------- |
| iOS      | Native Nitro context, storage, and HTTP worker. |
| Android  | Native Nitro context, storage, and HTTP worker. |
| Web      | Browser fetch and storage fallbacks.            |
| Expo     | Development builds with the config plugin.      |

## Troubleshooting

- **Expo Go error:** build a dev client; Expo Go cannot load Nitro modules.
- **Events do not send:** check API keys, network controls, dry-run state, and
  `flush()` result metadata.
- **Experiment variant missing:** call `start()` or `fetch()` before `variant()`
  unless you intentionally rely on fallback variants.
- **Android context errors:** ensure the Expo plugin is configured and native
  code was rebuilt after adding it.

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
