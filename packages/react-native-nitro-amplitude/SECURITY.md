# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.6.x   | Yes       |
| 0.5.x   | No        |
| 0.4.x   | No        |
| 0.3.x   | No        |
| 0.2.x   | No        |
| 0.1.x   | No        |

The latest `0.6.x` release is the only supported line. Older lines are
unsupported and receive no security fixes; upgrade to the current release to
receive security updates.

## Dependency support

- `react-native-nitro-modules` is supported in the range
  `>=0.37.0 <0.38.0` and moves in lockstep with this package (see
  `docs/dependency-policy.md`).
- Amplitude runtime packages (`@amplitude/analytics-core`,
  `@amplitude/analytics-connector`, `@amplitude/experiment-core`,
  `@amplitude/ua-parser-js`) must be upgraded together with the package
  release that pins their versions (see `docs/dependency-policy.md`).

## Reporting

Report vulnerabilities via GitHub Security Advisories on the repository:
https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/security/advisories

## Notes

- Do not commit Amplitude API keys or experiment deployment keys.
- Native storage persists analytics/experiment cache in app sandbox
  (SharedPreferences / UserDefaults) in plain text. The package does not
  encrypt persisted state; do not rely on it for secrets.
- HTTP transport runs on a native background thread; payloads may contain
  analytics event data — use TLS endpoints only.
