# AGENTS.md - react-native-nitro-amplitude

Nitro-powered Amplitude Analytics + Experiment SDK for React Native (Expo SDK 57 / RN 0.86.3 example; RN 0.87 source type check).

## Package

- Publishable package: `packages/react-native-nitro-amplitude`
- Example app: `apps/example` (Expo Router, SDK 57)

## Native ABI

Three C++ HybridObjects (see `nitro.json`):

| Key                | C++ class                | Role                                           |
| ------------------ | ------------------------ | ---------------------------------------------- |
| `AmplitudeContext` | `HybridAmplitudeContext` | Sync device context (cached by option set)     |
| `AmplitudeStorage` | `HybridAmplitudeStorage` | Sync memory/disk KV for analytics + experiment |
| `AmplitudeWorker`  | `HybridAmplitudeWorker`  | Bounded-concurrency background HTTP queue      |

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
bun run example:prebuild:clean
bun run example:android
bun run example:ios
```

## Android context init

`android/src/main/java/com/nitroamplitude/NitroAmplitudeInitializer.kt` (a
manifest-registered initializer) calls
`AndroidAmplitudeAdapter.setContext(applicationContext)`. The Expo config
plugin (`app.plugin.js`) is only a package registration point for CNG
projects; apps must not call `setContext` manually.

## Release bar

- `bun run check` (lint, format, typecheck, test:types, test, test:cpp)
- `bun run release:preflight` (+ benchmark, example checks, pack audit)
- Example prebuild + Android/iOS launch when native code changes
- `bun run android:test` (Kotlin JVM tests) is a required local release step; it needs the generated example Android project (`bun run example:prebuild`), so it is not part of `check` or CI.
- PR body is the current version's CHANGELOG section. The GitHub release
  description must match it. Do not add Summary, Test plan, or extra sections.

## Known gaps

- Legacy Amplitude SDK SQLite migration was removed; the package does not
  import data written by the legacy Amplitude SDK.
- Default Amplitude HTTP endpoints gzip JSON bodies ≥ 1 KiB (`Content-Encoding: gzip`). Custom `serverUrl` hosts stay uncompressed. JSONL deletes use tombstones; see `docs/native-libraries.md`.
- Web uses browser fetch and storage fallbacks without native Nitro bindings.
- Smoke flows run deterministically in dry-run fixture mode; real-network
  example flows require keys from `apps/example/.env.local`.

## Replay maintenance

- Package runtime or example changes must include a review of `e2e/amplitude-replay-coverage.json` and the affected `.ad` flows. Update assertions for changed behavior before running `bun run example:replay:refresh`.
- `bun run example:replay:check` validates coverage and source freshness without using a device. Keep it in the package quality gate; a refreshed source lock is not runtime verification.
- Run `bun run example:replay` against an explicit platform and device after building the matching example. Keep device execution out of CI and store run artifacts in OS temp.
- Fixture transport, native HTTP, and provider-dependent evidence must remain distinct. A required blocked or skipped case must not produce a full-validation PASS.
