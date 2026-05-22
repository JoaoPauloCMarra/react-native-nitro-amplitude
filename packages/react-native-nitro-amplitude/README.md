# react-native-nitro-amplitude

[![npm](https://img.shields.io/npm/v/react-native-nitro-amplitude)](https://www.npmjs.com/package/react-native-nitro-amplitude)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![React Native](https://img.shields.io/badge/react--native-%3E%3D0.75-61dafb)](https://reactnative.dev/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.35.7-black)](https://nitro.margelo.com/)

High-performance Amplitude Analytics and Experiment SDK for React Native, powered by Nitro Modules and C++.

This package combines the public APIs of `amplitude-rn-analytics` and `amplitude-rn-experiment` with a native Nitro layer for:

- synchronous JSI key-value storage (analytics events + experiment variants)
- synchronous device/application context collection
- background HTTP transport for uploads and experiment fetches

## Install

```sh
bun add react-native-nitro-amplitude react-native-nitro-modules@>=0.35.7
```

Peer dependencies: `react`, `react-native`, and `react-native-nitro-modules >=0.35.7`.

Expo SDK 56:

```sh
bunx expo install react-native-nitro-amplitude react-native-nitro-modules
```

Add the config plugin and prebuild:

```json
{
  "expo": {
    "plugins": ["react-native-nitro-amplitude"]
  }
}
```

## Analytics quick start

```ts
import { init, track, identify, flush } from "react-native-nitro-amplitude";

await init("YOUR_API_KEY", "user-id", {
  instanceName: "$default_instance",
  trackingSessionEvents: true,
}).promise;

track("button_clicked", { screen: "home" });
await flush().promise;
```

## Experiment quick start

```ts
import { Experiment, init } from "react-native-nitro-amplitude";

await init("YOUR_API_KEY").promise;

const experiment = Experiment.initializeWithAmplitudeAnalytics("YOUR_API_KEY");
await experiment.start();

const variant = experiment.variant("my-flag");
```

## Compatibility imports

The root entry exports both Analytics and Experiment APIs for new code:

```ts
import { init, track, Experiment } from "react-native-nitro-amplitude";
```

For migrations that need a clearer boundary between the two original packages,
the package also exposes compatibility subpaths:

```ts
import { init, track } from "react-native-nitro-amplitude/analytics";
import { Experiment } from "react-native-nitro-amplitude/experiment";
```

`react-native-nitro-amplitude/analytics` mirrors the public entrypoint shape of
`amplitude-rn-analytics`. `react-native-nitro-amplitude/experiment` mirrors the
public entrypoint shape of `amplitude-rn-experiment`.

## Native HybridObjects

| Object             | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `AmplitudeContext` | Device context + legacy SDK migration hooks     |
| `AmplitudeStorage` | Memory + disk KV for analytics/experiment state |
| `AmplitudeWorker`  | Background HTTP queue                           |

## Upstream compatibility

This package is a Nitro-first replacement, not a forked merge of the two source
packages. The JavaScript API surface is intentionally aligned with:

- `amplitude-rn-analytics` 1.6.0 for analytics client methods, storage provider
  contracts, exported `Revenue`, `Identify`, and `Types`.
- `amplitude-rn-experiment` 1.8.13 for `Experiment`, `ExperimentClient`,
  config/user/variant/exposure/storage types, loggers, and memory storage.

The default implementations differ where Nitro provides the native layer:

- analytics storage uses Nitro-backed memory/disk storage by default;
- experiment storage uses Nitro-backed storage by default;
- analytics upload and experiment fetches use the native `AmplitudeWorker`;
- native context is read through the `AmplitudeContext` HybridObject.

## Platform support

| Platform | Analytics                                 | Experiment  | Native Nitro |
| -------- | ----------------------------------------- | ----------- | ------------ |
| iOS      | Yes                                       | Yes         | Yes          |
| Android  | Yes                                       | Yes         | Yes          |
| Web      | Unsupported entry (`index.web.ts` throws) | Unsupported | No           |

## Development

From the monorepo root:

```sh
bun install
bun run codegen
bun run build
bun run check
bun run example:generate-icons   # after editing assets/*.svg
bun run example:prebuild:clean
bun run example:android
bun run example:ios
```

See [AGENTS.md](./AGENTS.md) for package invariants and release bar.

## License

MIT
