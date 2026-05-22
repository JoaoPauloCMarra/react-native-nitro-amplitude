# Changelog

All notable changes to this project are documented in this file.

The format follows Keep a Changelog and the project adheres to SemVer.

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
- Web is explicitly unsupported; use platform-specific Amplitude SDKs on web.
