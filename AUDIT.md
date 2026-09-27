# Code Audit

Tick an item when it lands, and note the commit next to it.

- P0: broken today, the behaviour is wrong.
- P1: misleading today, users or contributors will get it wrong.
- P2: inconsistent with siblings or other layers, or costly to change.
- P3: polish, duplication, dead code.

Audited 2026-09-26 at `96ed217`. Read all 133 in-scope first-party source, test, example, native, and tooling files (20,335 lines), plus project guidance, configuration, native build wiring, CI workflows, and all four device-flow scripts. Excluded generated/vendor/build output, dependencies, lockfiles, and assets. Verification used isolated Bun probes, a host C++ probe, and the setup script with its command-execution boundary mocked. Device and release gates were not run for this tracker-only audit.

## P0: Broken

- [ ] 1. **A failed JSONL overwrite can destroy the previous durable value.** `JsonlSegmentStore::SetLocked` at `packages/react-native-nitro-amplitude/cpp/core/JsonlSegmentStore.cpp:175` removes the old index entry and may compact its segment before attempting the new append. A probe rotates a populated segment, fails the append while overwriting an old key, and loses the old value both immediately and after reopening. **Extract Function** for the append/commit boundary: retain the old row and index until the new append succeeds, then update the index and compact. Extend write-failure coverage to overwrite an existing key in an older segment.
- [ ] 2. **Web storage silently loses access to accepted writes when persistence fails.** `packages/react-native-nitro-amplitude/src/native/storage.web.ts:37` and `packages/react-native-nitro-amplitude/src/analytics/storage/local-storage.ts:83` save writes in memory and swallow `localStorage.setItem` failures, but reads prefer `localStorage.getItem` even if it returns null or an older value. Both actual implementations return undefined after a quota-style rejected write in the probe. **Extract Class** for their shared namespaced string-storage behavior, giving unpersisted per-key writes precedence until persistence succeeds; preserve each adapter's namespace and cover stale as well as missing durable values.
- [ ] 3. **A successful partial experiment fetch retains omitted flag assignments.** `storeVariants` at `packages/react-native-nitro-amplitude/src/experiment/experimentClient.ts:906` computes missing requested flag keys, then uses `for...in` at line 917 to remove array indices instead of flag names. After caching an assignment, a successful empty response for that requested flag leaves the old assignment active. **Substitute Algorithm** with iteration over the missing key values, and test a successful partial response that omits a previously cached flag.
- [ ] 4. **Custom endpoints can receive gzip despite the custom-host contract.** `shouldGzipAmplitudeRequest` at `packages/react-native-nitro-amplitude/cpp/core/Gzip.cpp:83` searches the whole URL for `amplitude.com`. A host probe confirms it enables compression for both `https://api.my-amplitude.com/track` and `https://custom.test/amplitude.com`; the worker consequently adds gzip encoding, despite documented custom endpoints being uncompressed. **Extract Function** for URL-authority validation and match the supported Amplitude domain at a DNS-label boundary; test misleading hostname and path substrings.

## P1: Misleading

- [ ] 5. **Setup reports success after codegen or build failure.** `scripts/setup.js:78` and line 81 ignore the false result from `execCommand`, whose catch at line 30 converts command failures to false; line 84 always prints “Setup complete!”. Running the actual script with only codegen/build commands stubbed to fail still reports success and returns normally. **Extract Function** for a required setup step and fail with a step-specific error before printing success.

## P3: Polish

### Dead code

- [ ] 6. **The Amplitude example retains an unrelated MathJax declaration.** `apps/example/types/react-native-mathjax-svg.d.ts:1` declares a package absent from the manifests and from source, tests, examples, and documentation. A repository-wide search outside dependencies/build output finds only this declaration; it is not a package export or runtime registration. **Remove Dead Code** by deleting the 13-line ambient declaration, which can mask an accidental unresolved import.

## Local implementation receipt — 2026-09-27

All six findings are implemented locally for proposed patch 0.8.7. Original checkboxes remain open: no landing commit or full native runtime acceptance exists.

- JSONL RED/GREEN covers failed rotated overwrite, partial append, failed tail trim on reopen, and compaction failure. The old value is kept until the new append succeeds; uncertain tails are retired. At the maximum segment ID, writes fail safely without wrapping. This is adapter/reopen proof, not a power-loss/fsync guarantee.
- Browser adapters share authoritative failed-write overrides and deletion tombstones. Ordinary external changes remain visible. An incomplete reset intentionally hides ambiguous cross-tab values until successful reset or local write; queued events cannot prove freshness. Browser and focused regression tests cover this boundary.
- Partial experiment fetch removes actual omitted flag keys; gzip eligibility uses the HTTP(S) authority and DNS boundary; setup fails at required failed steps; the unused declaration is removed.
- `release:preflight` PASS: 78 JS tests, native tests/sanitizers, declarations, example checks, package audit and dry run. A final docs-only pack check follows the last clarified README wording.
- Isolated Chromium: actual storage preset and LocalStorage failure/recovery cases PASS. Actual example `/e2e` dry-run fixture health, records, variant and combined client PASS, with no page errors or external requests.
- Android/iOS prebuild/build PASS with `EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1`. Native installation/launch/smoke remains pending target selection.
- Logs: `/tmp/nitro-implementation.GbjgqhYj/amplitude-{release-preflight-final,browser,browser-example,android-build,ios-build}.log`; extra recovery RED/GREEN logs are under `/tmp/nitro-amplitude-followup/`.

No native/provider performance gain, commit or publication is claimed.

Final docs-only package audit and publish dry-run: PASS after the consumer-facing wording cleanup. Runtime acceptance remains pending; no landing/publication claimed.
