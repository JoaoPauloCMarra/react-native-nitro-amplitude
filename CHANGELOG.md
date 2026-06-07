# Changelog

All notable changes to this project are documented in this file.

The format follows Keep a Changelog and the project adheres to SemVer.

## 0.5.1 - 2026-06-07

### Changed

- Updated the Expo example SDK 56 patch dependencies so Expo Doctor passes cleanly.

## 0.5.0 - 2026-05-23

### Added

- Root exports for `NitroExperimentStorage`, durable analytics and experiment
  storage presets, `createAmplitudeClient`, and `createPersistentAmplitudeConfig`.
- First-class persistent session configuration through Nitro-backed Analytics
  cookie storage plus Nitro-backed event and Experiment variant storage.
- Diagnostics and health-check APIs for initialized state, identity, queue size,
  active instance names, native module availability, storage writability, and
  last native error.
- Structured `AmplitudeErrorCode` values and `AmplitudeError` for stable
  application-level failure handling.
- Global network disable controls, dry-run Analytics transport, dry-run
  Experiment HTTP client, and inspection helpers for captured dry-run requests.
- Reusable request timing wrappers for Analytics transport and Experiment HTTP
  clients, plus a bounded timing buffer for example apps and benchmarks.
- Example app timing output that separates app/package code execution time from
  HTTP request time for Analytics and Experiment validation flows.
- Experiment fetch metadata, variant source metadata, per-flag cache inspection,
  explicit variant cache clearing, fetch deduplication, and typed variant helper
  functions.
- Official typed test helpers for fake Analytics clients, fake Experiment
  clients, and fake Experiment storage.
- Stronger public TypeScript contracts for combined clients and reusable
  network timing buffers.

### Changed

- Analytics native builds now use the Nitro transport default when no custom
  transport provider is supplied.
- Analytics context enrichment now caches native app context per client to avoid
  repeated native crossings on every event.
- Web root and compatibility entrypoints now use browser fetch and storage
  fallbacks while preserving native-facing TypeScript compatibility.
- README now documents default storage behavior, exposure tracking, import
  paths, Expo config plugin behavior, native rebuild requirements, diagnostics,
  privacy controls, benchmark-safe setup, troubleshooting, compatibility,
  lifecycle recipes, and production verification.

### Fixed

- `createAmplitudeClient` now exposes a non-optional Experiment client in
  TypeScript when an Experiment deployment key is configured.
- Root `getDiagnostics()` now reports the combined analytics, native, and
  network diagnostic state for both native and web entrypoints.
- Web Experiment defaults no longer require native Nitro imports before browser
  fallbacks are selected.
- Native timeout normalization now rejects non-finite values before C++ integer
  conversion.
- Package docs sync and pack dry-runs restore README contents without leaving
  transient backup artifacts.

## 0.2.0 - 2026-05-22

### Added

- Web support for the root, Analytics, and Experiment entrypoints using browser
  fetch and storage fallbacks.
- Type coverage for web exports, named Analytics and Experiment identity
  sharing, and typed configuration objects.

### Fixed

- Android background HTTP worker crash caused by missing JNI thread class loader
  context.
- Named Analytics instances now share identity with matching named Experiment
  clients.
- Example Android launch script now defaults to the standard local Android SDK
  path when SDK environment variables are missing.
- Example smoke test now asserts resolved variants through stable accessibility
  identifiers.

### Changed

- README, package metadata, and platform support documentation now reflect
  native Nitro support on iOS and Android plus web-compatible fallbacks.
- GitHub release publishing workflow now supports release-triggered publishing
  and manual dry-run recovery.
- Removed the generated app-icon script; committed iOS and Android app icon
  assets remain the source of truth.

## 0.1.0 - 2026-05-22

### Added

- Initial Nitro-powered Amplitude Analytics + Experiment SDK for React Native.
- C++ HybridObjects: `AmplitudeContext`, `AmplitudeStorage`, `AmplitudeWorker`.
- Analytics API compatible with `amplitude-rn-analytics` (init, track, identify, flush, reset, shutdown, …).
- Experiment API compatible with `amplitude-rn-experiment` (initialize, start, fetch, variant, exposure, …).
- Compatibility import subpaths: `react-native-nitro-amplitude/analytics` and `react-native-nitro-amplitude/experiment`.
- Native storage and HTTP transport defaults via Nitro JSI instead of JS fetch + in-memory maps.
- Expo 56 example app with analytics + experiment demo screen.
- Monorepo scripts aligned with other `react-native-nitro-*` packages (`check`, `release:preflight`, example gates).

### Notes

- Legacy Amplitude SDK SQLite migration hooks are stubbed on native; full migration parity is planned.
- At initial release, web was explicitly unsupported; web support was added in 0.2.0.
