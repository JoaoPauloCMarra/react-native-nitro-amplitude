import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import {
  AmplitudeError,
  Experiment,
  Identify,
  NitroAnalyticsStorage,
  Revenue,
  createAmplitudeClient,
  createInstance,
  flushWithResult,
  getDeviceId,
  getDiagnostics,
  getSafeDiagnostics,
  getSessionId,
  getUserId,
  groupIdentify,
  healthCheck,
  identify,
  init,
  nitroHttpClient,
  prefetchNativeContext,
  reset,
  revenue,
  setGroup,
  setNetworkEnabled,
  setOptOut,
  setUserId,
  track,
} from "react-native-nitro-amplitude";
import {
  DryRunTransport,
  clearDryRunTransportRecords,
  getDryRunAnalyticsEvents,
  getNetworkEnabled,
} from "react-native-nitro-amplitude/network";
import { Button, Card, Colors, StatusRow, styles } from "./shared";

const DRY_RUN = process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN === "1";
const ANALYTICS_API_KEY = "nitro-amplitude-dry-run-analytics-key";
const EXPERIMENT_API_KEY = "nitro-amplitude-dry-run-experiment-key";

const DEMO_FLAG_BODY = JSON.stringify({
  "demo-flag": { key: "on", value: "on" },
});

let failNextExperimentVariantRequest = false;

const fixtureHttpClient = {
  async request(requestUrl: string) {
    if (
      requestUrl.includes("/sdk/v2/flags") &&
      !requestUrl.includes("vardata")
    ) {
      return { status: 200, body: "[]" };
    }
    if (requestUrl.includes("vardata") && failNextExperimentVariantRequest) {
      failNextExperimentVariantRequest = false;
      return { status: 503, body: '{"error":"expected replay failure"}' };
    }
    return { status: 200, body: DEMO_FLAG_BODY };
  },
};

type AmplitudeE2eLabProps = {
  fixtureUrl?: string;
  runId?: string;
};

function hasRecordedEvent(eventType: string): boolean {
  return getDryRunAnalyticsEvents().some((record) =>
    record.payload.events.some((event) => event.event_type === eventType),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fixtureEndpoint(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${endpoint}`;
}

export function AmplitudeE2eLab({ fixtureUrl, runId }: AmplitudeE2eLabProps) {
  const [contextStatus, setContextStatus] = useState("(idle)");
  const [storageStatus, setStorageStatus] = useState("(idle)");
  const [identityStatus, setIdentityStatus] = useState("(idle)");
  const [nativeHttpStatus, setNativeHttpStatus] = useState("(idle)");
  const [nativeHttpErrorStatus, setNativeHttpErrorStatus] = useState("(idle)");
  const [networkStatus, setNetworkStatus] = useState("(idle)");
  const [revenueStatus, setRevenueStatus] = useState("(idle)");
  const [groupStatus, setGroupStatus] = useState("(idle)");
  const [screenStatus, setScreenStatus] = useState("(idle)");
  const [healthStatus, setHealthStatus] = useState("(idle)");
  const [recordsStatus, setRecordsStatus] = useState("(idle)");
  const [clientStatus, setClientStatus] = useState("(idle)");
  const [stressStatus, setStressStatus] = useState("(idle)");
  const [analyticsStatus, setAnalyticsStatus] = useState("(idle)");
  const [variantStatus, setVariantStatus] = useState("(idle)");
  const [lifecycleStatus, setLifecycleStatus] = useState("(idle)");
  const [ready, setReady] = useState(false);
  const [experimentClient] = useState(() =>
    Experiment.initializeWithAmplitudeAnalytics(EXPERIMENT_API_KEY, {
      instanceName: "e2e-lab",
      automaticExposureTracking: true,
      fetchOnStart: false,
      pollOnStart: false,
      httpClient: fixtureHttpClient,
    }),
  );

  useEffect(() => {
    let cancelled = false;
    const initialize = getDiagnostics().initialized
      ? Promise.resolve()
      : init(ANALYTICS_API_KEY, "e2e-user", {
          instanceName: "e2e-lab",
          trackingSessionEvents: true,
          transportProvider: new DryRunTransport(),
        }).promise;
    void initialize
      .then(() => experimentClient.start({ user_id: "e2e-user" }))
      .then(() => {
        if (!cancelled) {
          setReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAnalyticsStatus(
            `fail:init=${error instanceof Error ? error.message.slice(0, 40) : "error"}`,
          );
        }
      });
    return () => {
      cancelled = true;
      experimentClient.stop();
    };
  }, [experimentClient]);

  return (
    <Card
      title="E2E Lab"
      subtitle="Remaining public Amplitude APIs (dry-run only)"
      indicatorColor={Colors.accent}
    >
      <View testID="e2e-lab" accessibilityLabel="E2E Lab">
        <StatusRow
          testID="e2e-context-status"
          label="native context"
          value={contextStatus}
        />
        <StatusRow
          testID="e2e-storage-status"
          label="durable storage"
          value={storageStatus}
        />
        <StatusRow
          testID="e2e-identity-status"
          label="identity"
          value={identityStatus}
        />
        <StatusRow
          testID="e2e-revenue-status"
          label="revenue"
          value={revenueStatus}
        />
        <StatusRow
          testID="e2e-native-http-status"
          label="native HTTP echo"
          value={nativeHttpStatus}
        />
        <StatusRow
          testID="e2e-native-http-error-status"
          label="native HTTP status"
          value={nativeHttpErrorStatus}
        />
        <StatusRow
          testID="e2e-network-status"
          label="network policy"
          value={networkStatus}
        />
        <StatusRow
          testID="e2e-group-status"
          label="group"
          value={groupStatus}
        />
        <StatusRow
          testID="e2e-screen-status"
          label="screen"
          value={screenStatus}
        />
        <StatusRow
          testID="e2e-health-status"
          label="health"
          value={healthStatus}
        />
        <StatusRow
          testID="e2e-records-status"
          label="records"
          value={recordsStatus}
        />
        <StatusRow
          testID="e2e-client-status"
          label="client"
          value={clientStatus}
        />
        <StatusRow
          testID="e2e-analytics-status"
          label="analytics"
          value={analyticsStatus}
        />
        <StatusRow
          testID="e2e-variant-status"
          label="variant"
          value={variantStatus}
        />
        <StatusRow
          testID="e2e-lifecycle-status"
          label="Experiment lifecycle"
          value={lifecycleStatus}
        />
        <StatusRow
          testID="e2e-stress-result"
          label="stress"
          value={stressStatus}
        />
        <StatusRow
          testID="e2e-runtime-ready"
          label="ready"
          value={ready ? "ok:ready" : "warming"}
        />

        <View style={styles.row}>
          <Button
            testID="e2e-context-run"
            title="Native context"
            onPress={() => {
              try {
                prefetchNativeContext();
                const deviceId = getDeviceId();
                const sessionId = getSessionId();
                setContextStatus(
                  typeof deviceId === "string" &&
                    deviceId.length > 0 &&
                    typeof sessionId === "number"
                    ? "ok:context=device+session"
                    : "fail:context",
                );
              } catch {
                setContextStatus("fail:context");
              }
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-storage-write"
            title="Write relaunch marker"
            onPress={() => {
              if (!runId) {
                setStorageStatus("blocked:replay-run-id-required");
                return;
              }
              void (async () => {
                try {
                  const storage = new NitroAnalyticsStorage<{ runId: string }>(
                    "e2e-replay-durable",
                  );
                  await storage.set("native-relaunch-marker", { runId });
                  // Outlasts the 200 ms PERSIST_FLUSH_DEBOUNCE_MILLIS storage flush.
                  await new Promise<void>((resolve) =>
                    setTimeout(resolve, 300),
                  );
                  setStorageStatus("ok:storage=written");
                } catch {
                  setStorageStatus("fail:storage=write");
                }
              })();
            }}
            style={styles.flex1}
          />
        </View>

        <View style={styles.row}>
          <Button
            testID="e2e-storage-read"
            title="Read relaunch marker"
            onPress={() => {
              if (!runId) {
                setStorageStatus("blocked:replay-run-id-required");
                return;
              }
              void (async () => {
                try {
                  const storage = new NitroAnalyticsStorage<{ runId: string }>(
                    "e2e-replay-durable",
                  );
                  const marker = await storage.get("native-relaunch-marker");
                  setStorageStatus(
                    marker?.runId === runId
                      ? "ok:storage=restored"
                      : "fail:storage=missing-or-stale",
                  );
                } catch {
                  setStorageStatus("fail:storage=read");
                }
              })();
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-native-http-run"
            title="Native HTTP echo"
            onPress={() => {
              if (!fixtureUrl) {
                setNativeHttpStatus("blocked:local-fixture-url-required");
                return;
              }
              void nitroHttpClient
                .request(
                  fixtureEndpoint(fixtureUrl, "/echo"),
                  "POST",
                  { "Content-Type": "application/json" },
                  JSON.stringify({ probe: "e2e-native-http-probe" }),
                  5000,
                )
                .then((response) => {
                  let body: unknown;
                  try {
                    body = JSON.parse(response.body);
                  } catch {
                    setNativeHttpStatus("fail:native-http=invalid-json");
                    return;
                  }
                  const valid =
                    response.status === 200 &&
                    isRecord(body) &&
                    body.ok === true &&
                    body.method === "POST" &&
                    body.path === "/echo" &&
                    body.body === '{"probe":"e2e-native-http-probe"}';
                  setNativeHttpStatus(
                    valid ? "ok:native-http=echo" : "fail:native-http=echo",
                  );
                })
                .catch(() => {
                  setNativeHttpStatus("fail:native-http=request");
                });
            }}
            style={styles.flex1}
          />
        </View>

        <View style={styles.row}>
          <Button
            testID="e2e-native-http-error-run"
            title="Native HTTP 503"
            onPress={() => {
              if (!fixtureUrl) {
                setNativeHttpErrorStatus("blocked:local-fixture-url-required");
                return;
              }
              void nitroHttpClient
                .request(
                  fixtureEndpoint(fixtureUrl, "/status/503"),
                  "GET",
                  {},
                  null,
                  5000,
                )
                .then((response) => {
                  const expected =
                    response.status === 503 &&
                    response.body.includes('"status":503');
                  setNativeHttpErrorStatus(
                    expected
                      ? "ok:native-http=status=503"
                      : "fail:native-http=status",
                  );
                })
                .catch(() => {
                  setNativeHttpErrorStatus("fail:native-http=status-request");
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-network-policy-run"
            title="Network disabled"
            onPress={() => {
              if (!fixtureUrl) {
                setNetworkStatus("blocked:local-fixture-url-required");
                return;
              }
              const previous = getNetworkEnabled();
              setNetworkEnabled(false);
              void nitroHttpClient
                .request(
                  fixtureEndpoint(fixtureUrl, "/health"),
                  "GET",
                  {},
                  null,
                  5000,
                )
                .then(() => {
                  setNetworkStatus("fail:network=allowed");
                })
                .catch((error: unknown) => {
                  const blocked =
                    error instanceof AmplitudeError &&
                    error.code === "network_error" &&
                    error.message === "Amplitude network traffic is disabled";
                  setNetworkStatus(
                    blocked
                      ? "ok:network=blocked"
                      : "fail:network=unexpected-error",
                  );
                })
                .finally(() => {
                  setNetworkEnabled(previous);
                });
            }}
            style={styles.flex1}
          />
        </View>

        <View style={styles.row}>
          <Button
            testID="e2e-opt-out-run"
            title="Opt-out + reset"
            onPress={() => {
              clearDryRunTransportRecords();
              setOptOut(true);
              track("e2e_opted_out");
              setOptOut(false);
              void (async () => {
                try {
                  const result = await flushWithResult();
                  const eventEscaped = hasRecordedEvent("e2e_opted_out");
                  reset();
                  setUserId("e2e-user");
                  setIdentityStatus(
                    result.ok && !eventEscaped && getUserId() === "e2e-user"
                      ? "ok:optout=suppressed:reset=restored"
                      : "fail:optout",
                  );
                } catch {
                  reset();
                  setUserId("e2e-user");
                  setIdentityStatus("fail:optout=flush");
                }
              })();
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-revenue-run"
            title="Revenue"
            onPress={() => {
              clearDryRunTransportRecords();
              const event = new Revenue()
                .setProductId("e2e-sku")
                .setPrice(1.25)
                .setQuantity(2);
              revenue(event);
              void flushWithResult()
                .then((result) => {
                  const recorded = getDryRunAnalyticsEvents().some((record) =>
                    record.payload.events.some(
                      (item) =>
                        item.event_properties?.["$productId"] === "e2e-sku" &&
                        item.event_properties?.["$price"] === 1.25 &&
                        item.event_properties?.["$quantity"] === 2,
                    ),
                  );
                  setRevenueStatus(
                    result.ok && recorded
                      ? "ok:revenue=sku:e2e-sku:qty=2"
                      : "fail:revenue",
                  );
                })
                .catch(() => {
                  setRevenueStatus("fail:revenue=flush");
                });
            }}
            style={styles.flex1}
          />
        </View>

        <View style={styles.row}>
          <Button
            testID="e2e-group-run"
            title="Group"
            onPress={() => {
              clearDryRunTransportRecords();
              setGroup("plan", "e2e");
              groupIdentify("plan", "e2e", new Identify().set("seat", "qa"));
              track("e2e_group_probe");
              void flushWithResult()
                .then((result) => {
                  const recorded = getDryRunAnalyticsEvents().some((record) =>
                    record.payload.events.some(
                      (event) =>
                        event.event_type === "e2e_group_probe" &&
                        event.groups?.plan === "e2e",
                    ),
                  );
                  setGroupStatus(
                    result.ok && recorded
                      ? "ok:group=plan:e2e:event=recorded"
                      : "fail:group",
                  );
                })
                .catch(() => {
                  setGroupStatus("fail:group=flush");
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-screen-run"
            title="Screen"
            onPress={() => {
              const instance = createInstance();
              instance.trackScreenView("E2E Lab");
              setScreenStatus("ok:screen");
            }}
            style={styles.flex1}
          />
        </View>

        <View style={styles.row}>
          <Button
            testID="e2e-health-run"
            title="Health"
            onPress={() => {
              void healthCheck()
                .then((result) => {
                  const safe = getSafeDiagnostics();
                  const full = getDiagnostics();
                  const diagnosticsReady = safe.initialized && full.initialized;
                  if (Platform.OS === "web") {
                    const nativeUnsupported =
                      !result.ok &&
                      !result.nativeAvailable &&
                      !result.diskStorageWritable &&
                      !result.workerReady;
                    setHealthStatus(
                      diagnosticsReady && nativeUnsupported
                        ? "ok:health=unsupported:safe=true:full=true"
                        : "fail:health",
                    );
                    return;
                  }
                  setHealthStatus(
                    result.ok && diagnosticsReady
                      ? "ok:health=true:safe=true:full=true"
                      : "fail:health",
                  );
                })
                .catch(() => {
                  setHealthStatus("fail:health");
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-records-run"
            title="Dry-run records"
            onPress={() => {
              clearDryRunTransportRecords();
              track("e2e_record_probe");
              void flushWithResult()
                .then((result) => {
                  const found = hasRecordedEvent("e2e_record_probe");
                  setRecordsStatus(
                    result.ok && found
                      ? "ok:events=record-probe"
                      : "fail:events",
                  );
                })
                .catch(() => {
                  setRecordsStatus("fail:events");
                });
            }}
            style={styles.flex1}
          />
        </View>

        <View style={styles.row}>
          <Button
            testID="e2e-identify-run"
            title="Identify"
            onPress={() => {
              clearDryRunTransportRecords();
              identify(new Identify().set("e2e_screen", "lab"));
              track("e2e_identity_probe");
              void flushWithResult()
                .then((result) => {
                  const recorded = getDryRunAnalyticsEvents().some((record) =>
                    record.payload.events.some(
                      (event) =>
                        event.event_type === "e2e_identity_probe" &&
                        event.user_id === "e2e-user",
                    ),
                  );
                  setAnalyticsStatus(
                    result.ok && recorded
                      ? "ok:identity=user=e2e-user:event=recorded"
                      : "fail:identity",
                  );
                })
                .catch(() => {
                  setAnalyticsStatus("fail:identity=flush");
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-flush-run"
            title="Flush"
            onPress={() => {
              clearDryRunTransportRecords();
              track("e2e_flush_probe");
              void flushWithResult()
                .then((result) => {
                  const recorded = hasRecordedEvent("e2e_flush_probe");
                  setAnalyticsStatus(
                    result.ok && recorded
                      ? `ok:flush=ok:event=flush-probe:sent=${result.sent}`
                      : "fail:flush",
                  );
                })
                .catch(() => {
                  setAnalyticsStatus("fail:flush");
                });
            }}
            style={styles.flex1}
          />
        </View>
        <View style={styles.row}>
          <Button
            testID="e2e-variant-run"
            title="Variant"
            onPress={() => {
              setVariantStatus("fetching");
              void experimentClient
                .fetchWithMetadata(
                  { user_id: "e2e-user" },
                  { flagKeys: ["demo-flag"] },
                )
                .then((result) => {
                  const resolved =
                    experimentClient.variantWithMetadata("demo-flag");
                  const value = resolved.variant?.value;
                  if (
                    result.fetched &&
                    result.flagKeys.includes("demo-flag") &&
                    value === "on"
                  ) {
                    setVariantStatus("ok:flag=on");
                    return;
                  }
                  setVariantStatus(
                    `fail:flag:fetched=${result.fetched}:keys=${result.flagKeys.join(",") || "none"}:value=${String(value ?? "undef")}:reason=${result.failureReason?.slice(0, 40) ?? "none"}`,
                  );
                })
                .catch((error: unknown) => {
                  setVariantStatus(
                    `fail:flag=${error instanceof Error ? error.message.slice(0, 40) : "error"}`,
                  );
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-lifecycle-run"
            title="Experiment stop + restart"
            onPress={() => {
              void (async () => {
                try {
                  const baseline = await experimentClient.fetchWithMetadata(
                    { user_id: "e2e-user" },
                    { flagKeys: ["demo-flag"] },
                  );
                  if (!baseline.fetched) {
                    setLifecycleStatus("fail:lifecycle=baseline");
                    return;
                  }
                  failNextExperimentVariantRequest = true;
                  const failed = await experimentClient.fetchWithMetadata(
                    { user_id: "e2e-user" },
                    { flagKeys: ["demo-flag"] },
                  );
                  const stale =
                    experimentClient.variantWithMetadata("demo-flag");
                  const staleObserved =
                    !failed.fetched &&
                    failed.cacheHit &&
                    stale.variant.value === "on" &&
                    stale.freshness === "stale";
                  experimentClient.stop();
                  await experimentClient.start({ user_id: "e2e-user" });
                  const restarted = await experimentClient.fetchWithMetadata(
                    { user_id: "e2e-user" },
                    { flagKeys: ["demo-flag"] },
                  );
                  const fresh =
                    experimentClient.variantWithMetadata("demo-flag");
                  setLifecycleStatus(
                    staleObserved &&
                      restarted.fetched &&
                      fresh.variant.value === "on" &&
                      fresh.freshness === "fresh"
                      ? "ok:lifecycle=stale-then-fresh"
                      : "fail:lifecycle",
                  );
                } catch {
                  experimentClient.stop();
                  setLifecycleStatus("fail:lifecycle=restart");
                }
              })();
            }}
            style={styles.flex1}
          />
        </View>
        <Button
          testID="e2e-run-stress"
          title="Stress 50 tracks"
          onPress={() => {
            const started = globalThis.performance?.now?.() ?? Date.now();
            for (let index = 0; index < 50; index += 1) {
              track("e2e_stress_track", { index });
            }
            const elapsed =
              (globalThis.performance?.now?.() ?? Date.now()) - started;
            setStressStatus(`ok:tracks=50:ms=${elapsed.toFixed(1)}`);
          }}
        />
        <Button
          testID="e2e-client-run"
          title="Combined client"
          onPress={() => {
            const client = createAmplitudeClient({
              analyticsApiKey: "nitro-amplitude-dry-run-analytics-key",
              experimentDeploymentKey: "nitro-amplitude-dry-run-experiment-key",
              userId: "e2e-combined",
              dryRun: true,
              instanceName: "e2e-combined",
            });
            void client
              .init({ user_id: "e2e-combined" })
              .then(() => {
                setClientStatus(
                  client.getUserId() === "e2e-combined" && DRY_RUN
                    ? "ok:user=e2e-combined:dry=1"
                    : "fail:client",
                );
              })
              .catch(() => {
                setClientStatus("fail:client");
              });
          }}
        />
      </View>
    </Card>
  );
}
