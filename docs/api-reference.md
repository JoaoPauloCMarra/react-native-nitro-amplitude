# API Reference

## Analytics (default export)

Re-exports the analytics client surface from `@amplitude/analytics-core` with React Native wiring:

- `init`, `track`, `logEvent`, `identify`, `groupIdentify`, `setGroup`, `revenue`
- `flush`, `reset`, `shutdown`, `setOptOut`, `extendSession`
- `getUserId`, `setUserId`, `getDeviceId`, `setDeviceId`, `getSessionId`, `setSessionId`
- `add`, `remove` (plugins)
- `createInstance()` for multi-instance setups
- `Revenue`, `Identify`, `Types`

## Experiment

- `Experiment.initialize(apiKey, config?)`
- `Experiment.initializeWithAmplitudeAnalytics(apiKey, config?)`
- `ExperimentClient`: `start`, `stop`, `fetch`, `fetchOrThrow`, `variant`, `all`, `exposure`, `clear`, …
- Config types: `ExperimentConfig`, `Defaults`, `Source`, `Variant`, `ExperimentUser`, …

## Nitro helpers

- `prefetchNativeContext()` — warm native device context cache
- `NitroAnalyticsStorage`, `NitroMemoryStorage` — JSI-backed storage adapters
- `nitroHttpClient`, `nitroTransport` — background native HTTP for uploads/fetches

## HybridObject specs

See `src/AmplitudeContext.nitro.ts`, `src/AmplitudeStorage.nitro.ts`, `src/AmplitudeWorker.nitro.ts`.
