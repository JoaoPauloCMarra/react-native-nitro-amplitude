# AGENTS.md - react-native-nitro-amplitude

Nitro-powered Amplitude Analytics + Experiment SDK for React Native (Expo 56 / RN 0.85).

## Package

- Publishable package: `packages/react-native-nitro-amplitude`
- Example app: `apps/example` (Expo Router, SDK 56)

## Native ABI

Three C++ HybridObjects (see `nitro.json`):

| Key | C++ class | Role |
|-----|-----------|------|
| `AmplitudeContext` | `HybridAmplitudeContext` | Sync device context + legacy migration hooks |
| `AmplitudeStorage` | `HybridAmplitudeStorage` | Sync memory/disk KV for analytics + experiment |
| `AmplitudeWorker` | `HybridAmplitudeWorker` | Background HTTP queue |

Never hand-edit `nitrogen/generated/**`; run `bun run codegen` after spec changes.

## Public API

- **Analytics:** compatible with `amplitude-rn-analytics` (`init`, `track`, `identify`, `flush`, `reset`, `shutdown`, …)
- **Experiment:** compatible with `amplitude-rn-experiment` (`Experiment.initialize`, `start`, `fetch`, `variant`, …)
- **Nitro defaults:** native storage, context, and HTTP transport replace JS fetch + in-memory maps

## Workflow

```bash
cd packages/react-native-nitro-amplitude
bun run codegen    # after *.nitro.ts or nitro.json changes
bun run build
bun run typecheck
bun run test
bun run test:cpp
```

From monorepo root:

```bash
bun install
bun run build
bun run check
bun run release:preflight
bun run example:generate-icons   # after editing apps/example/scripts/generate-icons.sh
bun run example:prebuild:clean
bun run example:android
bun run example:ios
```

## Android context init

`app.plugin.js` injects `AndroidAmplitudeAdapter.setContext(this)` in `MainApplication.onCreate`.

## Release bar

- `bun run check` (lint, format, typecheck, test:types, test, test:cpp)
- `bun run release:preflight` (+ benchmark, example checks, pack audit)
- Example prebuild + Android/iOS launch when native code changes

## Known gaps

- Legacy Amplitude SDK SQLite migration returns empty stubs on native (TODO).
- Web entry explicitly unsupported (`src/index.web.ts`).
