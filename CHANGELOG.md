# Changelog

All notable changes to this project are documented in this file.

The format follows Keep a Changelog and the project adheres to SemVer.

## [0.10.0] - 2026-10-01

### Breaking changes

- Native HTTP response bodies are read up to 4 MiB. A longer body is cut at
  4 MiB and the request still completes with its status code and no error.
  This applies to `nitroHttpClient` and `nitroTransport`. Migration: do not
  use `nitroHttpClient` for responses larger than 4 MiB.
- The native upload queue rejects a new request with `queue_full` when more
  than 64 MiB of request bodies and headers are queued, in addition to the
  100-request limit. A request is always accepted when the queue is empty.
  Migration: treat `queue_full` as retryable, as for the request limit.
- `GET` and `HEAD` requests are sent without a body on iOS and Android. Android
  used to send a `GET` with a body as a `POST`. Migration: send request data in
  a `POST`.
- An HTTP method that is empty or is not a valid HTTP token completes with
  `network_error` on both platforms. Methods are sent in upper case. `PATCH`
  and custom methods are not supported on Android.
- `remove`, `clear`, `getAllKeys`, and `getKeysByPrefix` on native disk storage
  throw `storage_error` while the storage directory cannot be opened. They
  used to return without doing anything. Migration: handle the rejection as
  you do for a failed write.
- The key `\x7fDEL` is reserved and is rejected with `storage_error`. A value
  written under that key was already read back as deleted.
- Android: a malformed URL returns `invalid_url` instead of `network_error`,
  as on iOS.

### Fixed

- Disk writes that fail because the disk or quota is full no longer leave
  partial records or extra segment files. Storage is unchanged after the
  error and works again when space is free. A segment that cannot be opened
  for writing is retired once, not on every failure.
- If the storage directory is removed while the app runs, the next write
  creates it again. Storage keeps its data when a directory check fails, and
  it opens when its directory exists even if a parent directory cannot be
  created.
- Empty segment files and leftover temporary files from an interrupted
  compaction are removed when storage opens. Segments that hold only delete
  markers are merged when every later segment was read completely, so the
  number of storage files stays bounded.
- Segment files with an id above 4294967295 are ignored. On 32-bit Android
  such a file stopped the module from starting.
- Records above 4 GiB are rejected with `storage_error` instead of being
  truncated.
- Calling a worker unsubscribe function after the worker is released no
  longer crashes.
- A worker thread that fails to start reports an error instead of terminating
  the process.
- Request bodies above 2 GiB are sent uncompressed.
- Legacy preference migration resumes later without importing a deleted key
  again.
- Android: storage calls made before the package initializer has run fail
  with `storage_error` and recover on later calls. A context prefetch before
  initialization no longer crashes the process.
- Android: a storage write with no storage directory throws `storage_error`
  instead of being dropped.
- Android: an empty locale list falls back to the default locale.
- Android: HTTP bodies or header arrays above 2 GiB fail with a network error
  instead of overflowing.
- Android: file offsets are 64-bit on 32-bit devices.
- iOS: strings that are not valid UTF-8 in the NSUserDefaults fallback are
  treated as missing on read and rejected with `storage_error` on write,
  instead of crashing. Strings that contain NUL are stored and read intact.
- iOS: an unavailable `identifierForVendor` is no longer cached as empty.

## [0.9.1] - 2026-09-30

### Breaking changes

- None.

### Compatibility

- The `react-native` peer range is now `>=0.77.0` (was `>=0.75.0`), and the
  optional `expo` peer is `>=53.0.0`. This corrects the declared floor. It is
  not a new requirement: `react-native-nitro-modules` 0.37, which 0.9.x
  already requires, does not build on React Native 0.75 or 0.76, so those
  versions could never build this package. Supported: React Native >= 0.77 /
  Expo SDK >= 53 (the Nitro 0.37 minimum). Tested: React Native 0.86.3 / Expo
  SDK 57.

### Fixed

- Deleted native disk keys no longer come back after an app relaunch. Segment
  compaction now keeps a delete marker while an older segment can still hold
  the key, including a segment that could not be read at startup. New writes
  go to a segment above any unreadable segment.
- A read error during segment compaction no longer deletes live keys.
  Compaction stops and leaves the data unchanged.
- `remove(key, true)`, `removeBatch`, `clear(true)`, namespace `reset()`, and
  `NitroExperimentStorage.delete` now reject when the delete cannot be written
  to disk; `getAmplitudeErrorCode` classifies the error as `storage_error`.
  Before, they resolved while the key was still stored.
- Android release builds that enable R8 or ProGuard minification keep every
  adapter method that native code calls by name. Before, native object creation
  could fail in minified builds.
- Experiment user context now uses the Experiment targeting keys `os`
  (`"<os name> <os version>"`), `device_model`, `device_brand`,
  `device_manufacturer`, `version`, `platform`, `language`, `country`, and
  `carrier`. Targeting rules on OS and device fields now match. Native
  identifiers such as `idfv` are no longer added to the Experiment user.
- Two failed Experiment fetches that run at the same time no longer leave a
  retry that `stop()` and `setUser()` cannot cancel. Finished retries are
  released.
- Calling `init()` right after `shutdown()` no longer leaves a client that
  reports ready but does not send events. `init()` waits for the shutdown to
  finish.
- While `setNetworkEnabled(false)` is active, analytics events sent through the
  package's network transports (the default Nitro transport and the web fetch
  transport) stay queued, and scheduled flushes do not count as retry
  attempts, so events are not dropped after `flushMaxRetries`. Uploads resume
  on the next flush interval (at least 1 second) after the network is enabled,
  or at once when you call `flush()`. `DryRunTransport` and custom transports
  keep running while the network is disabled.
- Each `MemoryStorage` / `InMemoryStorage` instance keeps its own data, so
  `reset()` on one instance no longer clears the others. This also applies to
  the fallback paths that create a `MemoryStorage`: an Experiment client
  created with `storage: null` and the deprecated Experiment `LocalStorage`
  now keep variants per instance instead of in one process-wide map.
- Native disk-adapter and per-request HTTP exceptions now classify as
  `storage_error` and `network_error` instead of `native_unavailable`.
- A failed analytics upload is recorded once in `diagnosticFailures`, and
  `throttledCount` counts repeated failures.
- The `react-native-nitro-amplitude/analytics` entry and the `Types` namespace
  export type-only names with `export type`, so strict ESM bundlers can load
  them. The runtime enums `IdentifyOperation`, `RevenueProperty`,
  `SpecialEventType`, `LogLevel`, and `ServerZone` stay value exports.
- `healthCheck()` writes one fixed probe key instead of a new key per call, so
  repeated checks no longer leave delete markers on disk.
- The `testing` mock `healthCheck()` returns `diskStorageWritable` and
  `workerReady`.

### Changed

- The iOS podspec uses React Native's `min_ios_version_supported` instead of a
  fixed iOS 13.0 floor.
- The config plugin loads `expo/config-plugins`. `expo` is an optional peer
  dependency.
- `parseVariantJson` and the `VariantFreshness` type are exported from
  `react-native-nitro-amplitude/experiment`.
- The package is marked `"sideEffects": false`.
- Removed the `unfetch` dependency. Experiment web requests use the global
  `fetch`.
- `@amplitude/ua-parser-js` is used only by the web context module. Web
  context keeps the Browser SDK fallbacks: `device_model` falls back to the OS
  name, and `os_name` / `os_version` fall back to the browser name and version.
- Update the pinned `@amplitude/analytics-core` dependency from `2.58.0` to
  `2.59.0`.

### Deprecated

- The Experiment `LocalStorage` export (`ExperimentLocalStorage` from the root
  entry) keeps variants in memory only. Use `NitroExperimentStorage` or
  `createDurableAmplitudeStoragePreset` for durable variants.
- The Android `initializeNitroAmplitude` Kotlin helper. The package initializer
  already sets the Android context, so apps do not need to call it.

## [0.9.0] - 2026-09-30

### Breaking changes

- Native analytics uploads now run every 30 seconds instead of every second,
  when 30 events are queued, or when the app moves to the background. Events
  stay in durable native storage until they upload. Web keeps the 1 second
  interval. A `track(...).promise` on native now resolves when its batch
  uploads, which can take up to 30 seconds.

  Migration: to keep the previous timing, pass `flushIntervalMillis: 1000` to
  `init(...)` or to `analytics` in `createAmplitudeClient(...)`. Call
  `flush()` when an upload must happen now.

### Changed

- Native analytics uploads queued events when the app moves to the background.
  A failed background upload keeps the events in storage for the next attempt.

## [0.8.8] - 2026-09-27

### Breaking changes

- None.

### Fixed

- Include the fixed-width integer header explicitly so the native gzip helper compiles with Linux Clang.

## [0.8.7] - 2026-09-27

### Breaking changes

- None.

### Fixed

- Native JSONL overwrites retain the prior value when appending fails, including rotated segments and torn writes. Compaction follows a successful replacement append.
- Browser storage preserves in-process fallback writes, removals, and resets when localStorage is unavailable or denies access.
- Partial Experiment fetches remove missing requested flags by their actual keys, including numeric string keys, while retaining unrequested flags.
- Native gzip selection matches only the exact Amplitude domain or its subdomains, excluding lookalike hosts and domain text in paths or queries.

## [0.8.6] - 2026-09-24

### Breaking changes

- None.

### Changed

- Updated Amplitude Analytics core to `2.58.0`, Analytics connector to `^1.6.8`,
  and Experiment core to `^0.13.6` while retaining the existing public API.

### Fixed

- Adapted the Analytics configuration types to the broader upstream storage
  provider contract without changing the event storage behavior.

## [0.8.5] - 2026-09-24

### Breaking changes

- None.

### Fixed

- Android sends gzipped Amplitude request bodies through JNI as bytes, preserving
  the compressed payload and avoiding a native crash when sending larger events.

## [0.8.4] - 2026-09-18

### Breaking changes

- None.

### Added

- Hidden example identity lab at `nitroamplitude://e2e-identity` for dry-run
  `reset` / `identify` / `setUserId` coverage.

### Changed

- The example Expo pin follows SDK 57.0.24 (`expo-doctor` / `expo install --check`).
  React Native stays `0.86.3`.
- The example iOS host uses a `SceneDelegate` so the app can present a window on
  iOS 27 physical devices.
- Native HTTP worker gzips JSON bodies ≥ 1 KiB to `*.amplitude.com` with
  `Content-Encoding: gzip`. JSONL deletes append tombstones and compact only
  when a segment is more than 50% dead. See
  [docs/native-libraries.md](docs/native-libraries.md).

## [0.8.3] - 2026-09-16

### Breaking changes

- None.

### Fixed

- Explicit experiment user properties now override stale analytics-provider properties.
- Changing users or clearing experiment assignments invalidates outstanding fetches and retries without deduplicating or removing a newer request.
- Assignment response ordering remains valid when clearing during a pending storage write.
- Experiment cache writes remain ordered with asynchronous storage adapters, including clears after older writes and recovery after storage failures.

## [0.8.2] - 2026-09-10

### Breaking changes

- None.

### Fixed

- iOS builds using static frameworks and source-built React Native now resolve
  Folly and React Native headers when compiling the Nitro Swift/C++ bridge.

## [0.8.1] - 2026-09-09

### Breaking changes

- None.

### Fixed

- Apply the Kotlin Android plugin only when the Gradle Kotlin extension is
  absent, so AGP 9 consumers that already ship built-in Kotlin can configure
  the library.

### Changed

- Raised `@amplitude/analytics-core` to `2.55.0` after reviewing the
  published tarball: the only runtime change is an optional diagnostics
  storage constructor argument. Public analytics APIs are unchanged.

## [0.8.0] - 2026-08-25

### Breaking changes

- None when upgrading from `0.7.x`. Direct upgrades from `0.6.x` still require
  the Nitro 0.37 native rebuild described in the `0.7.0` entry.

### Changed

- Analytics event persistence is now coalesced: tracked events are batched
  in memory and written to native disk after a short debounce. Pending writes
  are also flushed when the app becomes inactive or enters the background, and
  explicit `flush()` and `shutdown()` calls remain durability boundaries.
  Durable reads stay read-your-writes consistent and write ordering is
  preserved. Each coalesced flush now crosses JSI once through native
  `setBatch` instead of issuing one native write call per key.
- Restored the deprecated `AmplitudeContext` legacy session/event methods and
  the `AmplitudeStorage.setBatch`/`getBatch` ABI wrappers for source and native
  compatibility. They do not import legacy Amplitude SQLite data;
  `migrateLegacyData` remains an accepted no-op.
- Experiment fetch retries now apply ±20% jitter to backoff delays.
- The iOS HTTP transport now reuses one shared `NSURLSession` instead of
  creating and invalidating a session per request.

### Fixed

- JSONL compaction keeps the previous durable data when an atomic replacement
  write fails and retries the operation later.
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
- The package and Expo SDK 57 example use the React Native 0.86.2 baseline.
- Normalized `AppState.currentState` at the React Native boundary so the
  package remains type-safe under React Native's Strict TypeScript API.

## [0.6.0] - 2026-08-12

### Breaking changes

- None. Legacy bridge methods, `migrateLegacyData`, and the `string[]`
  `AmplitudeStorage.getBatch` contract remained available. The `/network` and
  `/testing` subpaths are preferred for clearer production bundles but are not
  mandatory.

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
