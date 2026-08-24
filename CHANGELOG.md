# Changelog

All notable changes to this project are documented in this file.

The format follows Keep a Changelog and the project adheres to SemVer.

## [0.8.0] - 2026-08-24

### Breaking changes

- Removed the no-op legacy migration methods `getLegacySessionDataJson`,
  `getLegacyEventsJson`, and `removeLegacyEvent` from the
  `AmplitudeContext` HybridObject. These stubs returned empty data and had
  no production callers. The `migrateLegacyData` option remains accepted as a
  no-op compatibility option; legacy Amplitude SDK data was never imported.
  Migrate that data before switching SDKs if it is required.
- Removed the unused batch storage API `setBatch`/`getBatch` from the
  `AmplitudeStorage` HybridObject and the `getBatchValues` helper and
  `BATCH_MISSING_SENTINEL` export from `react-native-nitro-amplitude`.
  Migrate by reading and writing keys individually with `get`/`set` or by
  using `removeBatch` for bulk cleanup.

### Changed

- Analytics event persistence is now coalesced: tracked events are batched
  in memory and written to native disk after a short debounce or an explicit
  `flush()`. Durable reads stay read-your-writes consistent and write ordering
  is preserved.
- Experiment fetch retries now apply ±20% jitter to backoff delays.
- The iOS HTTP transport now reuses one shared `NSURLSession` instead of
  creating and invalidating a session per request.

### Fixed

- The iOS podspec no longer compiles the C++ test binary
  (`HybridAmplitudeStorageTest.cpp`, which contains its own `main`) into
  the app pod.

## [0.7.0] - 2026-08-20

### Breaking changes

- The `react-native-nitro-modules` peer range is now `>=0.37.0 <0.38.0`.
  Upgrade the Nitro package and rebuild native projects when upgrading from
  0.6.0.

### Changed

- Upgraded Nitro Modules and Nitrogen to 0.37.0 and regenerated the committed
  native bindings.
- Updated the Amplitude analytics and experiment runtime dependencies to their
  current compatible patch releases.
- The standalone package development and type baseline is now React Native
  0.87.0. The Expo SDK 57 example remains on its supported React Native 0.86.2
  baseline.
- Normalized `AppState.currentState` at the React Native boundary so the
  package remains type-safe under React Native 0.87's Strict TypeScript API.

## [0.6.0] - 2026-08-12

### Breaking changes

- None. At the 0.6.0 release, legacy migration methods, `migrateLegacyData`,
  the `string[]` `AmplitudeStorage.getBatch` contract, and established root
  exports remained available. The current Unreleased entry records the
  removal of the no-op native migration methods and batch contract. The new
  `/network` and `/testing` subpaths are preferred for clearer production
  bundles but are not mandatory.

### Changed

- Default analytics identity is durable: device ID, user ID, and session ID
  survive app restarts through the Nitro disk store on native and browser
  localStorage on web.
- `shutdown()` flushes accepted events before teardown; `flushWithResult()`
  reports `failed` and `retried` as distinct outcomes.
- Analytics, experiment, and combined `reset()` now clear analytics identity
  and experiment user/cache together.
- Native transport errors carry stable codes (`invalid_url`, `timeout`,
  `cancelled`, `invalid_http_response`, `network_error`) instead of localized
  message text.
- Diagnostics report per-capability native availability, bounded worker
  metrics, and disk/worker probes from `healthCheck()`.
- Experiment variants report `freshness` (`fresh`, `stale`, `unknown`), and
  `Experiment.reinitialize` replaces singletons explicitly.
- Web `LocalStorage` keys are namespaced and `reset()` clears only package
  keys, matching native namespace-scoped reset behavior.
- Batch missing-value decoding now verifies key existence, so a real stored
  value equal to the legacy sentinel round-trips without changing the native
  `string[]` ABI.

## [0.5.5] - 2026-07-30

### Fixed

- Omitted unavailable Android context fields instead of returning empty
  identifiers, matching the native context omission contract.
- Shared web memory storage across package instances in the same JavaScript
  process while preserving namespace isolation.
- Rejected non-finite, fractional, and out-of-range legacy event IDs before
  converting them to native 64-bit integers.
- Aligned CocoaPods source resolution with the repository's `v<version>`
  release tags.

### Changes

- **Breaking changes:** None.
- Added typed Analytics screen-view methods to clients returned by
  `createInstance()`, including React Navigation state tracking.
- Updated the Analytics and Experiment runtime dependencies, including
  `@amplitude/analytics-core` 2.54.1.
- Raised the Nitro Modules peer range to `>=0.36.4 <0.37.0` and set React
  Native 0.86 with Expo SDK 57 development builds as the release baseline.
- Expanded consumer documentation for compatibility, native installation,
  error handling, and platform-specific behavior.

## [0.5.4] - 2026-06-11

### Fixed

- Added a package-owned Android manifest initializer so native context setup no longer requires generated `MainApplication` edits in Expo or bare React Native apps.
- Tied Expo config plugin run-once metadata to the package version so plugin updates reapply after package upgrades.

### Changed

- Included `CHANGELOG.md` in the packed package docs.

## [0.5.3] - 2026-06-11

### Fixed

- iOS HTTP worker waits are now bounded: requests that never complete are
  cancelled and reported as timeouts instead of permanently stalling the upload
  queue, and the URL session enforces a total resource timeout in addition to
  the idle timeout.
- Android HTTP connection setup failures (invalid URL, connect errors during
  body write) are returned as structured results instead of escaping as
  exceptions across the JNI boundary.
- Events now report this package's own SDK identity and version
  (`amplitude-nitro-ts/<version>`, `experiment-nitro-ts/<version>`) instead of
  stale upstream Amplitude SDK version strings.

### Changed

- Updated `@amplitude/analytics-core` to `2.49.0`, picking up the React Native
  `btoa` fix.
- HTTP request headers now cross the JS/native boundary as a typed
  `Record<string, string>` instead of a JSON string (native rebuild required).
- The native context, storage, and HTTP worker now share a single platform
  adapter instance, and storage/worker report external memory usage to the JS
  garbage collector.
- Android serves the default application context from the prefetched cache.

### Added

- `getNativeStartupDiagnostics().legacyMigrationSupported` reports whether
  legacy Amplitude SDK SQLite migration is available (currently `false`;
  `migrateLegacyData` logs a debug notice and restores no legacy data).
- README documentation for the native architecture, the Android
  `adid`/`appSetId` privacy stance, offline usage with a connectivity listener,
  and typed Experiment variant payload access.

## [0.5.2] - 2026-06-10

### Fixed

- Disabled Amplitude Analytics console logging by default so transient transport
  failures do not flood React Native console capture tools such as Sentry.
- Added sanitized transport failure diagnostics to `getDiagnostics()` for
  Analytics uploads and Experiment fetches without logging payloads or API keys.
- Added safe diagnostics snapshots and surface-specific failure data so apps can
  distinguish Analytics uploads, Experiment variant fetches, and Experiment flag
  config fetches without logging identifiers.
- Changed the default Experiment cache to durable Nitro storage so cached
  feature assignments survive transient fetch failures and app restarts.

## [0.5.1] - 2026-06-07

- No package changes; repository/example-only release.

## [0.5.0] - 2026-05-23

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
  clients, with a bounded network timing buffer.
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

## [0.2.0] - 2026-05-22

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

### Changed

- README, package metadata, and platform support documentation now reflect
  native Nitro support on iOS and Android plus web-compatible fallbacks.

## [0.1.0] - 2026-05-22

### Added

- Initial Nitro-powered Amplitude Analytics + Experiment SDK for React Native.
- C++ HybridObjects: `AmplitudeContext`, `AmplitudeStorage`, `AmplitudeWorker`.
- Analytics API compatible with `amplitude-rn-analytics` (init, track, identify, flush, reset, shutdown, …).
- Experiment API compatible with `amplitude-rn-experiment` (initialize, start, fetch, variant, exposure, …).
- Compatibility import subpaths: `react-native-nitro-amplitude/analytics` and `react-native-nitro-amplitude/experiment`.
- Native storage and HTTP transport defaults via Nitro JSI instead of JS fetch + in-memory maps.

### Notes

- Legacy Amplitude SDK SQLite migration hooks are stubbed on native; full migration parity is planned.
- At initial release, web was explicitly unsupported; web support was added in 0.2.0.
