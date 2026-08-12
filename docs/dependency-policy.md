# Amplitude Dependency Lockstep Policy

This package replaces `amplitude-rn-analytics` and `amplitude-rn-experiment`
and therefore owns a set of Amplitude runtime dependencies. The following
packages must move **together in a single release**:

| Package | Role | Lockstep rule |
| --- | --- | --- |
| `@amplitude/analytics-core` | Analytics client core | Exact-pinned (`2.54.1`). A bump is a release decision because it changes the analytics contract this package wraps. |
| `@amplitude/analytics-connector` | Analytics/Experiment identity bridge | Must be upgraded in the same release as `@amplitude/analytics-core` and `@amplitude/experiment-core` because it is the shared bridge between them. |
| `@amplitude/experiment-core` | Experiment evaluation core | Must be upgraded in the same release as `@amplitude/analytics-connector`; its transport and storage contracts are surfaced by this package. |
| `@amplitude/ua-parser-js` | Web user-agent parsing | Upgrades are independent of the analytics/experiment pair but are still recorded in the same release so the packaged contract is reproducible. |

`react-native-nitro-modules` (peer range `>=0.36.5 <0.37.0`) is the native
ABI dependency and must move together with `nitrogen` and this package's
generated bindings; see the root `scripts/verify-core-versions.ts` for the
recorded set.

## Enforcement

`bun run verify:core-versions` fails the quality gate when any recorded
Amplitude dependency spec in `packages/react-native-nitro-amplitude/package.json`
drifts from the table above. A dependency upgrade is not release-ready until
that check is updated in the same change and the package gate passes.
