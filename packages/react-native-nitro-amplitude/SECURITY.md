# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting

Report vulnerabilities via GitHub Security Advisories on the repository.

## Notes

- Do not commit Amplitude API keys or experiment deployment keys.
- Native storage persists analytics/experiment cache in app sandbox (SharedPreferences / UserDefaults).
- HTTP transport runs on a native background thread; payloads may contain analytics event data — use TLS endpoints only.
