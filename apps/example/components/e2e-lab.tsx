import { useCallback, useEffect, useState } from "react";
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
  getConnectorIdentity,
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
import {
  ANALYTICS_API_KEY,
  EXPERIMENT_API_KEY,
  createFixtureHttpClient,
  delay,
  fixtureEndpoint,
} from "./fixture";
import {
  Button,
  Card,
  Colors,
  ResultsProbe,
  StatusRow,
  styles,
} from "./shared";

const DRY_RUN = process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN === "1";

let failNextExperimentVariantRequest = false;

const fixtureHttpClient = createFixtureHttpClient(undefined, (requestUrl) => {
  if (requestUrl.includes("vardata") && failNextExperimentVariantRequest) {
    failNextExperimentVariantRequest = false;
    return { status: 503, body: '{"error":"expected replay failure"}' };
  }
  return undefined;
});

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

const STATUS_ROWS = [
  { key: "context", testID: "e2e-context-status", label: "native context" },
  { key: "storage", testID: "e2e-storage-status", label: "durable storage" },
  { key: "identity", testID: "e2e-identity-status", label: "identity" },
  { key: "revenue", testID: "e2e-revenue-status", label: "revenue" },
  {
    key: "nativeHttp",
    testID: "e2e-native-http-status",
    label: "native HTTP echo",
  },
  {
    key: "nativeHttpError",
    testID: "e2e-native-http-error-status",
    label: "native HTTP status",
  },
  { key: "network", testID: "e2e-network-status", label: "network policy" },
  { key: "group", testID: "e2e-group-status", label: "group" },
  { key: "screen", testID: "e2e-screen-status", label: "screen" },
  { key: "health", testID: "e2e-health-status", label: "health" },
  { key: "records", testID: "e2e-records-status", label: "records" },
  { key: "client", testID: "e2e-client-status", label: "client" },
  { key: "analytics", testID: "e2e-analytics-status", label: "analytics" },
  { key: "variant", testID: "e2e-variant-status", label: "variant" },
  {
    key: "lifecycle",
    testID: "e2e-lifecycle-status",
    label: "Experiment lifecycle",
  },
  { key: "stress", testID: "e2e-stress-result", label: "stress" },
] as const;

type StatusKey = (typeof STATUS_ROWS)[number]["key"];

const INITIAL_STATUSES = Object.fromEntries(
  STATUS_ROWS.map((row) => [row.key, "(idle)"]),
) as Record<StatusKey, string>;

export function AmplitudeE2eLab({ fixtureUrl, runId }: AmplitudeE2eLabProps) {
  const [statuses, setStatuses] =
    useState<Record<StatusKey, string>>(INITIAL_STATUSES);
  const setStatus = useCallback((key: StatusKey, value: string) => {
    setStatuses((current) => ({ ...current, [key]: value }));
  }, []);
  const [ready, setReady] = useState(false);
  const readyStatus = ready ? "ok:ready" : "warming";
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
      ? Promise.resolve().then(() => {
          setUserId("e2e-user");
        })
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
          setStatus(
            "analytics",
            `fail:init=${error instanceof Error ? error.message.slice(0, 40) : "error"}`,
          );
        }
      });
    return () => {
      cancelled = true;
      experimentClient.stop();
    };
  }, [experimentClient, setStatus]);

  return (
    <Card
      title="E2E Lab"
      subtitle="Remaining public Amplitude APIs (dry-run only)"
      indicatorColor={Colors.accent}
    >
      <View testID="e2e-lab" accessibilityLabel="E2E Lab">
        {STATUS_ROWS.map((row) => (
          <StatusRow
            key={row.key}
            testID={row.testID}
            label={row.label}
            value={statuses[row.key]}
          />
        ))}
        <StatusRow
          testID="e2e-runtime-ready"
          label="ready"
          value={readyStatus}
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
                setStatus(
                  "context",
                  typeof deviceId === "string" &&
                    deviceId.length > 0 &&
                    typeof sessionId === "number"
                    ? "ok:context=device+session"
                    : "fail:context",
                );
              } catch {
                setStatus("context", "fail:context");
              }
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-storage-write"
            title="Write relaunch marker"
            onPress={() => {
              if (!runId) {
                setStatus("storage", "blocked:replay-run-id-required");
                return;
              }
              void (async () => {
                try {
                  const storage = new NitroAnalyticsStorage<{ runId: string }>(
                    "e2e-replay-durable",
                  );
                  await storage.set("native-relaunch-marker", { runId });
                  // Outlasts the 200 ms PERSIST_FLUSH_DEBOUNCE_MILLIS storage flush.
                  await delay(300);
                  setStatus("storage", "ok:storage=written");
                } catch {
                  setStatus("storage", "fail:storage=write");
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
                setStatus("storage", "blocked:replay-run-id-required");
                return;
              }
              void (async () => {
                try {
                  const storage = new NitroAnalyticsStorage<{ runId: string }>(
                    "e2e-replay-durable",
                  );
                  const marker = await storage.get("native-relaunch-marker");
                  setStatus(
                    "storage",
                    marker?.runId === runId
                      ? "ok:storage=restored"
                      : "fail:storage=missing-or-stale",
                  );
                } catch {
                  setStatus("storage", "fail:storage=read");
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
                setStatus("nativeHttp", "blocked:local-fixture-url-required");
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
                    setStatus("nativeHttp", "fail:native-http=invalid-json");
                    return;
                  }
                  const valid =
                    response.status === 200 &&
                    isRecord(body) &&
                    body.ok === true &&
                    body.method === "POST" &&
                    body.path === "/echo" &&
                    body.body === '{"probe":"e2e-native-http-probe"}';
                  setStatus(
                    "nativeHttp",
                    valid ? "ok:native-http=echo" : "fail:native-http=echo",
                  );
                })
                .catch(() => {
                  setStatus("nativeHttp", "fail:native-http=request");
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
                setStatus(
                  "nativeHttpError",
                  "blocked:local-fixture-url-required",
                );
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
                  setStatus(
                    "nativeHttpError",
                    expected
                      ? "ok:native-http=status=503"
                      : "fail:native-http=status",
                  );
                })
                .catch(() => {
                  setStatus(
                    "nativeHttpError",
                    "fail:native-http=status-request",
                  );
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-network-policy-run"
            title="Network disabled"
            onPress={() => {
              if (!fixtureUrl) {
                setStatus("network", "blocked:local-fixture-url-required");
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
                  setStatus("network", "fail:network=allowed");
                })
                .catch((error: unknown) => {
                  const blocked =
                    error instanceof AmplitudeError &&
                    error.code === "network_error" &&
                    error.message === "Amplitude network traffic is disabled";
                  setStatus(
                    "network",
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
                  setStatus(
                    "identity",
                    result.ok && !eventEscaped && getUserId() === "e2e-user"
                      ? "ok:optout=suppressed:reset=restored"
                      : "fail:optout",
                  );
                } catch {
                  reset();
                  setUserId("e2e-user");
                  setStatus("identity", "fail:optout=flush");
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
                  setStatus(
                    "revenue",
                    result.ok && recorded
                      ? "ok:revenue=sku:e2e-sku:qty=2"
                      : "fail:revenue",
                  );
                })
                .catch(() => {
                  setStatus("revenue", "fail:revenue=flush");
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
              void flushWithResult()
                .then((result) => {
                  const events = getDryRunAnalyticsEvents().flatMap(
                    (record) => record.payload.events,
                  );
                  const recorded =
                    events.some(
                      (event) =>
                        event.event_type === "$identify" &&
                        event.groups?.plan === "e2e",
                    ) &&
                    events.some(
                      (event) =>
                        event.event_type === "$groupidentify" &&
                        event.groups?.plan === "e2e" &&
                        event.group_properties?.$set?.seat === "qa",
                    );
                  setStatus(
                    "group",
                    result.ok && recorded
                      ? "ok:group=plan:e2e:event=recorded"
                      : "fail:group",
                  );
                })
                .catch(() => {
                  setStatus("group", "fail:group=flush");
                });
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-screen-run"
            title="Screen"
            onPress={() => {
              clearDryRunTransportRecords();
              const instance = createInstance();
              const navigationState = {
                index: 0,
                routes: [{ key: "e2e-lab", name: "e2e-lab" }],
              };
              void (async () => {
                try {
                  await instance.init(ANALYTICS_API_KEY, "e2e-user", {
                    instanceName: "e2e-screen",
                    trackingSessionEvents: false,
                    flushIntervalMillis: 60000,
                    transportProvider: new DryRunTransport(),
                  }).promise;
                  instance.trackScreenView("E2E Lab");
                  instance.trackScreenViewOnNavigationStateChange(
                    navigationState,
                  );
                  const duplicate =
                    await instance.trackScreenViewOnNavigationStateChange(
                      navigationState,
                    ).promise;
                  const result = await instance.flushWithResult();
                  const screens = getDryRunAnalyticsEvents()
                    .flatMap((record) => record.payload.events)
                    .filter(
                      (event) =>
                        event.event_type === "[Amplitude] Screen Viewed",
                    )
                    .map(
                      (event) =>
                        Object.entries(event.event_properties ?? {}).find(
                          ([key]) => key === "[Amplitude] Screen Name",
                        )?.[1],
                    );
                  setStatus(
                    "screen",
                    result.ok &&
                      duplicate === undefined &&
                      screens.length === 2 &&
                      screens.includes("E2E Lab") &&
                      screens.includes("e2e-lab")
                      ? "ok:screen=e2e-lab:dedup=1"
                      : `fail:screen=count=${screens.length}`,
                  );
                } catch {
                  setStatus("screen", "fail:screen=flush");
                } finally {
                  instance.shutdown();
                }
              })();
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
                    setStatus(
                      "health",
                      diagnosticsReady && nativeUnsupported
                        ? "ok:health=unsupported:safe=true:full=true"
                        : "fail:health",
                    );
                    return;
                  }
                  setStatus(
                    "health",
                    result.ok && diagnosticsReady
                      ? "ok:health=true:safe=true:full=true"
                      : "fail:health",
                  );
                })
                .catch(() => {
                  setStatus("health", "fail:health");
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
                  setStatus(
                    "records",
                    result.ok && found
                      ? "ok:events=record-probe"
                      : "fail:events",
                  );
                })
                .catch(() => {
                  setStatus("records", "fail:events");
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
                  setStatus(
                    "analytics",
                    result.ok && recorded
                      ? "ok:identity=user=e2e-user:event=recorded"
                      : "fail:identity",
                  );
                })
                .catch(() => {
                  setStatus("analytics", "fail:identity=flush");
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
                  setStatus(
                    "analytics",
                    result.ok && recorded
                      ? `ok:flush=ok:event=flush-probe:sent=${result.sent}`
                      : "fail:flush",
                  );
                })
                .catch(() => {
                  setStatus("analytics", "fail:flush");
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
              setStatus("variant", "fetching");
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
                    setStatus("variant", "ok:flag=on");
                    return;
                  }
                  setStatus(
                    "variant",
                    `fail:flag:fetched=${result.fetched}:keys=${result.flagKeys.join(",") || "none"}:value=${String(value ?? "undef")}:reason=${result.failureReason?.slice(0, 40) ?? "none"}`,
                  );
                })
                .catch((error: unknown) => {
                  setStatus(
                    "variant",
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
                    setStatus("lifecycle", "fail:lifecycle=baseline");
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
                  setStatus(
                    "lifecycle",
                    staleObserved &&
                      restarted.fetched &&
                      fresh.variant.value === "on" &&
                      fresh.freshness === "fresh"
                      ? "ok:lifecycle=stale-then-fresh"
                      : "fail:lifecycle",
                  );
                } catch {
                  experimentClient.stop();
                  setStatus("lifecycle", "fail:lifecycle=restart");
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
            clearDryRunTransportRecords();
            for (let index = 0; index < 50; index += 1) {
              track("e2e_stress_track", { index });
            }
            void flushWithResult()
              .then((result) => {
                const delivered = getDryRunAnalyticsEvents()
                  .flatMap((record) => record.payload.events)
                  .filter(
                    (event) => event.event_type === "e2e_stress_track",
                  ).length;
                setStatus(
                  "stress",
                  result.ok && delivered === 50
                    ? "ok:stress=50:delivered=50"
                    : `fail:stress=50:delivered=${delivered}`,
                );
              })
              .catch(() => {
                setStatus("stress", "fail:stress=flush");
              });
          }}
        />
        <Button
          testID="e2e-client-run"
          title="Combined client"
          onPress={() => {
            const client = createAmplitudeClient({
              analyticsApiKey: ANALYTICS_API_KEY,
              experimentDeploymentKey: EXPERIMENT_API_KEY,
              userId: "e2e-combined",
              dryRun: true,
              instanceName: "e2e-combined",
            });
            clearDryRunTransportRecords();
            void (async () => {
              try {
                await client.init({ user_id: "e2e-combined" });
                const userReady =
                  client.getUserId() === "e2e-combined" &&
                  getConnectorIdentity("e2e-combined").userId ===
                    "e2e-combined";
                client.analytics.track("e2e_combined_probe");
                const result = await client.analytics.flushWithResult();
                const recorded = getDryRunAnalyticsEvents().some((record) =>
                  record.payload.events.some(
                    (event) =>
                      event.event_type === "e2e_combined_probe" &&
                      event.user_id === "e2e-combined",
                  ),
                );
                client.reset();
                const connectorCleared =
                  client.getUserId() === undefined &&
                  getConnectorIdentity("e2e-combined").userId === undefined;
                setStatus(
                  "client",
                  DRY_RUN &&
                    userReady &&
                    result.ok &&
                    recorded &&
                    connectorCleared
                    ? "ok:combined=user+connector+event"
                    : `fail:combined=user=${userReady}:event=${recorded}:reset=${connectorCleared}`,
                );
              } catch {
                setStatus("client", "fail:combined");
              } finally {
                client.analytics.shutdown();
              }
            })();
          }}
        />
        <ResultsProbe
          testID="e2e-results"
          label={[
            ...STATUS_ROWS.map((row) => statuses[row.key]),
            readyStatus,
          ].join(" ")}
        />
      </View>
    </Card>
  );
}
