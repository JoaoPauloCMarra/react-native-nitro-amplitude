# react-native-nitro-amplitude

[![npm](https://img.shields.io/npm/v/react-native-nitro-amplitude)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![CI](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/actions/workflows/ci.yml/badge.svg)](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/blob/main/LICENSE)
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
bun add react-native-nitro-amplitude react-native-nitro-modules@>=0.35.7
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

## TypeScript

The package ships generated declaration files and re-exports the public
Analytics and Experiment types used by the implementation:

```ts
import type {
  ExperimentConfig,
  Logger,
  Variant,
} from "react-native-nitro-amplitude";
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
```

Prefer `satisfies` for configuration objects so TypeScript keeps literal values
while still checking option names and value types.

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

## Platform support

| Platform | Analytics | Experiment | Native Nitro |
| -------- | --------- | ---------- | ------------ |
| iOS      | Yes       | Yes        | Yes          |
| Android  | Yes       | Yes        | Yes          |
| Web      | Yes       | Yes        | No           |

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

See [AGENTS.md](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/blob/main/AGENTS.md)
for package invariants and release requirements.

## License

[MIT](https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/blob/main/LICENSE)
