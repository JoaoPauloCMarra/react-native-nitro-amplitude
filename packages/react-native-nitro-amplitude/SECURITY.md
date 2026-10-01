# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.10.x  | Yes       |
| < 0.10  | No        |

The latest `0.10.x` release is the only supported line. Older lines are
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

Report vulnerabilities privately through GitHub private vulnerability
reporting:
https://github.com/JoaoPauloCMarra/react-native-nitro-amplitude/security/advisories/new

Do not open public issues for security reports.

## Notes

- Do not commit Amplitude API keys or experiment deployment keys.
- Native storage persists the analytics and experiment cache as plain-text
  JSONL segment files in the app sandbox: `Application Support/nitro-amplitude`
  on iOS and `filesDir/nitro-amplitude` on Android. UserDefaults and
  SharedPreferences are read only once to migrate data from older package
  versions. The package does not encrypt persisted state; do not rely on it for
  secrets.
- HTTP transport runs on a native background thread; payloads may contain
  analytics event data — use TLS endpoints only.
