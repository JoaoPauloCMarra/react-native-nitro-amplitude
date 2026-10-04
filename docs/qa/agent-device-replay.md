# Amplitude example replay

The maintained replay entry is `scripts/run-example-replay.js`. It runs the
suite paths listed in `e2e/amplitude-replay-coverage.json` in order:

| Suite                            | Screen                                                                          | What it asserts                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e/qa-full-features.ad`        | `nitroamplitude://e2e`                                                          | Main lab controls, pressed one at a time, and the smoke runner                                                                                         |
| `e2e/qa-persistence-relaunch.ad` | `nitroamplitude://e2e` and `nitroamplitude://e2e-persistence?phase=write\|read` | Durable storage, durable Analytics identity, and Experiment disk and memory storage across an app relaunch                                             |
| `e2e/qa-deeplink.ad`             | `nitroamplitude://e2e-identity`                                                 | Identity lab load run and a pressed rerun                                                                                                              |
| `e2e/qa-network.ad`              | `nitroamplitude://e2e-network`                                                  | Native HTTP timeout, refused, and invalid URL errors; default `nitroTransport` delivery and HTTP 503; native Experiment fetch; diagnostics and timings |
| `e2e/qa-analytics-lab.ad`        | `nitroamplitude://e2e-analytics`                                                | Experiment exposure, sessions, plugins, device ID, shutdown, and Experiment helpers                                                                    |
| `e2e/qa-background.ad`           | `nitroamplitude://e2e-background`                                               | A queued dry-run event is uploaded by the AppState background flush after the app goes to the home screen and is reopened                              |

The main lab uses public controls and waits for their semantic results. The
network, analytics, persistence, and background screens run their cases when they load and
report every result in one accessibility probe at the top of the screen, so
the waits do not depend on the viewport size. Coverage rows for these screens
use `"trigger": "load"`: they have no `controlId`, and the suite must wait for
the probe's `statusId` before it waits for the expected text. The persistence
flow relaunches the app before it reads the values written by that same replay
run.

The background flow is the only flow that uses a device action. It queues one
probe event on an instance with a 600000 ms flush interval, sends the app to
the home screen with `home`, and reopens the same process with a plain `open`
(no `--relaunch`). The screen then requires exactly one recorded probe event,
recorded less than 120000 ms after it was queued. The reopen can take about
25 seconds on an iOS simulator, so its waits use longer timeouts.

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

The fixture serves these routes. It keeps no request data and uses no
Amplitude account.

| Route                           | Response                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /health`                   | `200` health body                                                                                                 |
| `POST /echo`                    | `200` with the method, path, and request body                                                                     |
| `GET /status/503`               | `503`                                                                                                             |
| `GET /delay/<ms>`               | `200` after the delay, capped at 5000 ms; headers are not sent before the delay ends                              |
| `POST /2/httpapi`               | `{"code":200,"events_ingested":N}` when the body has an `api_key` and a non-empty `events` array, otherwise `400` |
| `POST /2/httpapi/503`           | `503` `{"code":503}`                                                                                              |
| `GET` or `POST /sdk/v2/flags`   | `[]` when the `Authorization: Api-Key <key>` header is present, otherwise `401`                                   |
| `GET` or `POST /sdk/v2/vardata` | `demo-flag` set to `on` when the `Authorization` header is present, otherwise `401`                               |

The network screen derives a closed-port URL (port `1`) from the fixture host
for the refused-connection case. These checks prove that native HTTP and the
default native Analytics transport reached this local server and that the
worker returned the HTTP status and response body. They do not prove live
provider authentication or account-side event receipt.

An explicit `flushWithResult()` sends without the scheduled retry path, so an
HTTP 503 upload reports `ok: false`, drops the batch, and records an
`http_status` diagnostic failure. The replay asserts that behavior; it does
not assert that the events stay queued.

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

Do not add live API keys to this flow. The main lab and analytics screen use
isolated in-process fixture transports. Only the main lab's native HTTP rows,
the network screen, and the diagnostics timing case cross the native HTTP
worker, and they reach only the local fixture.

## Keep the replay current

The static check verifies that each replay control or load probe and expected
status still exists in the example source, every manifest assertion still
appears in its suite, pending provider rows remain pending, and the pinned source digest
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
