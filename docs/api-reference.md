# API Reference

## Analytics (default export)

Re-exports the analytics client surface from `@amplitude/analytics-core` with React Native wiring:

- `init`, `track`, `logEvent`, `identify`, `groupIdentify`, `setGroup`, `revenue`
- `flush`, `reset`, `shutdown`, `setOptOut`, `extendSession`
- `getUserId`, `setUserId`, `getDeviceId`, `setDeviceId`, `getSessionId`, `setSessionId`
- `add`, `remove` (plugins)
- `createInstance()` for multi-instance setups
- `Revenue`, `Identify`, `Types`

`flushWithResult()` returns explicit outcome counts: `sent`, `dropped`
(terminal server rejections), `retried` (events still queued for background
retry), and `failed` (terminal only). `shutdown()` flushes accepted events
before tearing the client down; events tracked after shutdown are not sent.

## Experiment

- `Experiment.initialize(apiKey, config?)` — returns the existing singleton
  for an instance name/API key pair; later configuration is ignored.
- `Experiment.reinitialize(apiKey, config?)` — stops and replaces the
  singleton for an instance name/API key pair.
- `Experiment.initializeWithAmplitudeAnalytics(apiKey, config?)`
- `ExperimentClient`: `start`, `stop`, `fetch`, `fetchOrThrow`, `variant`,
  `variantWithMetadata`, `all`, `exposure`, `clear`, …
- `variantWithMetadata()` returns a `freshness` state (`fresh`, `stale`,
  `unknown`) alongside `stale: boolean`.
- Config types: `ExperimentConfig`, `Defaults`, `Source`, `Variant`,
  `ExperimentUser`, …

## Diagnostics

- `getDiagnostics()` — analytics state plus native readiness per capability
  (`contextAvailable`, `storageAvailable`, `workerAvailable`,
  `nativeAvailable`), `networkEnabled`, `diagnosticFailures`, bounded
  `networkTimings`, and `workerMetrics` (queue size, in-flight count, pending
  body bytes).
- `getSafeDiagnostics()` — diagnostics without `userId`, `deviceId`, or
  `sessionId`, for support snapshots.
- `getNativeStartupDiagnostics()`, `getLastNativeError()` — module probing
  results and the last native startup failure.
- `healthCheck()` — probes the durable disk store and the worker; returns
  `diskStorageWritable`, `workerReady`, and `errors`.
- `clearDiagnosticFailures()` — resets recorded diagnostic failures.

## Network controls

Available on the `react-native-nitro-amplitude/network` subpath.

- `setNetworkEnabled(enabled)` / `getNetworkEnabled()` — global switch; all
  native and web transport paths throw a typed `network_error` while disabled.
- `DryRunTransport`, `DryRunHttpClient` — record-only transports for tests
  and examples.
- `getDryRunTransportRecords()`, `getDryRunAnalyticsEvents()`,
  `clearDryRunTransportRecords()` — dry-run record access.
- `createNetworkTimingBuffer(limit)`, `createTimedAnalyticsTransport(...)`,
  `createTimedHttpClient(...)` — bounded timing capture for analytics and
  experiment requests.

## Testing helpers

Available on the `react-native-nitro-amplitude/testing` subpath.

- `createMockAmplitudeClient()`, `createMockExperimentClient(variants)`,
  `createFakeExperimentStorage(values)` — in-memory mocks for tests and
  examples.

## Presets and combined client

- `createDurableAmplitudeStoragePreset({ namespace, dryRun })` — analytics
  events, analytics session, and experiment variant storage in one namespace.
- `createPersistentAmplitudeConfig(namespaceOrOptions)` — preset alias.
- `createAmplitudeClient(config)` — combined analytics + experiment client;
  `reset()` resets analytics identity and experiment user/cache together.
- `createExperimentUser(user)`, `getConnectorIdentity(instanceName)`.

## Storage adapters

- `NitroAnalyticsStorage`, `NitroExperimentStorage` — durable stores backed by
  the Nitro disk store on native and browser localStorage on web.
- `NitroMemoryStorage` — process-local store.
- `LocalStorage` — the durable default session store (Nitro disk on native,
  browser localStorage on web).
- `MemoryStorage` / `InMemoryStorage` — process-local stores.
- `NitroExperimentStorage` accepts a namespace; batch reads report missing
  keys as `null` through `getBatch`.

## Nitro helpers

- `prefetchNativeContext()` — warms the native device-context cache, including
  the normalized option set used by Experiment.
- `getNativeApplicationContext(options)` — JSON context for analytics and
  experiment targeting; missing native values are empty strings.
- `nitroHttpClient`, `nitroTransport` — background native HTTP for
  uploads/fetches with request-scoped completion and a bounded worker queue.

## HybridObject specs

See `src/AmplitudeContext.nitro.ts`, `src/AmplitudeStorage.nitro.ts`,
`src/AmplitudeWorker.nitro.ts`.

## Web differences

- Web uses browser `fetch` and storage fallbacks; no native modules are
  required and `workerMetrics` stays `undefined`.
- Web context reports `platform`, `language`, and OS/device fields parsed from
  the user agent; `carrier`, `adid`, `appSetId`, and `idfv` are unavailable.
- `LocalStorage` on web is backed by browser localStorage with an in-memory
  fallback; `MemoryStorage` is process-local.
- Web experiment fetches and analytics uploads share the same typed error
  surface (`network_error`, `timeout`, …).
