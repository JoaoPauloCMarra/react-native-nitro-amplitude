# Changelog

All notable changes to this project are documented in this file.

The format follows Keep a Changelog and the project adheres to SemVer.

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
