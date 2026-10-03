# Amplitude example replay

The maintained replay entry is `scripts/run-example-replay.js`. It runs the
suite paths listed in `e2e/amplitude-replay-coverage.json` in order. The core
flow uses the example's public controls and waits for their semantic results;
the persistence flow relaunches the app before reading the marker written by
that same replay run. The existing deep-link flow remains part of the suite.

`replay-asserted` in the coverage manifest describes an assertion authored in
the suite. It does not say that a device replay has run or passed. Fixture rows
exercise local behavior only. Live Amplitude ingestion and Experiment provider
rows stay `pending-prerequisites` until their approved staging credentials and
separate account-side evidence are available.

## Local HTTP fixture

The example's native HTTP checks call the public `nitroHttpClient`, which uses
the Nitro worker on iOS and Android. Start the small local fixture with an
address the selected target can reach:

```sh
bun scripts/example-replay-http-fixture.js --bind 127.0.0.1 --advertise-host 127.0.0.1 --port 4318
```

For an Android emulator, use the host gateway as the advertised address and
bind the server to an interface reachable through that gateway. For a physical
device, bind to a host interface on the same reachable network and advertise
that host's private address. Pick the address from the target and host network
setup; the runner does not enumerate devices or guess a host address.

The fixture serves `GET /health`, `POST /echo`, and `GET /status/503`. It keeps
no request data and uses no Amplitude account. The echo and 503 checks prove
that native HTTP reached this local server and that the worker returned the
HTTP status and response body. They do not prove live provider authentication
or account-side event receipt.

## Run the device replay

Build the example in fixture mode, then pass one exact target identifier and
the fixture origin. Set `EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1` when prebuilding or
building the app: the fixture-only iOS ATS and Android cleartext allowances are
native build configuration. A shell variable set after installing the app does
not change those settings, so rebuild after changing this build-time mode. The
replay waits for the app's visible `dry-run fixture` marker before exercising
any controls. A fixture release binary is valid; a fixture-mode Metro session
is also supported.

```sh
EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1 bun run example:prebuild
# Choose one native launch:
EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1 bun run example:ios
# Or: EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1 bun run example:android
# If the fixture app is already installed and Metro is separate:
# EXPO_PUBLIC_AMPLITUDE_DRY_RUN=1 bun run example:start:fixture
bun scripts/run-example-replay.js --platform ios --udid <UDID> --http-fixture-url http://127.0.0.1:4318
```

For Android, use `--platform android --serial <serial>` and the fixture URL
reachable from that target. The launcher rejects a missing or ambiguous target
and a non-local or missing fixture URL before starting `agent-device`. It
injects a unique run ID and encoded fixture URL into the replay deep link.
Artifacts go to a unique directory under the operating system's temporary
directory. `agent-device test` closes each attempt session itself, so the
launcher does not run a separate cleanup after a failure.

Do not add live API keys to this flow. The Analytics events and Experiment
variants use isolated fixture transports. The local HTTP probe is the only row
that crosses the native HTTP worker.

## Keep the replay current

The static check verifies that each replay control and expected status still
exists in the example source, every manifest assertion still appears in its
suite, pending provider rows remain pending, and the pinned source digest
matches covered package and example files:

```sh
bun scripts/check-example-replay-freshness.js
```

After reviewing a package or example change, update the relevant replay steps
and coverage rows, then refresh the lock:

```sh
bun scripts/check-example-replay-freshness.js --refresh
```

The digest includes package runtime source, generated Nitro bindings, and
wiring plus example app, component, asset, and runtime configuration files. It
excludes dependencies, tests, generated example native projects, git-ignored
files, build output, and its own lock file. The check is a drift guard; it is not runtime proof.

The scoped, non-device tests are:

```sh
bun test scripts/example-replay.test.ts
```
