# Amplitude Dependency Compatibility Policy

This package replaces `amplitude-rn-analytics` and `amplitude-rn-experiment`
and owns the following Amplitude runtime dependency set. Review and test the
set together when changing any member; an unchanged compatible dependency
does not require an artificial version bump.

| Package | Recorded manifest spec | Role |
| --- | --- | --- |
| `@amplitude/analytics-core` | `2.58.0` | Analytics client core; exact-pinned because its contract is wrapped by this package. |
| `@amplitude/analytics-connector` | `^1.6.8` | Shared Analytics/Experiment identity bridge. |
| `@amplitude/experiment-core` | `^0.13.6` | Experiment evaluation, transport, and storage contracts. |
| `@amplitude/ua-parser-js` | `^0.7.33` | Web user-agent parsing. |

`react-native-nitro-modules` (peer range `>=0.37.0 <0.38.0`) is the native
ABI dependency. Its development pin and `nitrogen` are both `0.37.1`;
regenerate and verify bindings whenever those pins change.

## Enforcement

`bun run verify:core-versions` checks the recorded manifest specs against
`scripts/verify-core-versions.ts`. It does not prove runtime compatibility
or require every member to change version in each release. Update the guard
and this table together when a spec changes. Run the package quality gate
and local platform smoke tests before declaring the dependency set ready.
