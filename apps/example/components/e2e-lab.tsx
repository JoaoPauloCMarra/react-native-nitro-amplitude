import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import {
  Experiment,
  Identify,
  Revenue,
  createAmplitudeClient,
  createInstance,
  flushWithResult,
  getDiagnostics,
  getSafeDiagnostics,
  groupIdentify,
  healthCheck,
  identify,
  init,
  reset,
  revenue,
  setGroup,
  setOptOut,
  track,
} from "react-native-nitro-amplitude";
import {
  DryRunTransport,
  clearDryRunTransportRecords,
  getDryRunAnalyticsEvents,
} from "react-native-nitro-amplitude/network";
import { Button, Card, Colors, StatusRow, styles } from "./shared";

const DRY_RUN = process.env.EXPO_PUBLIC_AMPLITUDE_DRY_RUN === "1";
const ANALYTICS_API_KEY = "nitro-amplitude-dry-run-analytics-key";
const EXPERIMENT_API_KEY = "nitro-amplitude-dry-run-experiment-key";

const DEMO_FLAG_BODY = JSON.stringify({
  "demo-flag": { key: "on", value: "on" },
});

const fixtureHttpClient = {
  async request(requestUrl: string) {
    if (
      requestUrl.includes("/sdk/v2/flags") &&
      !requestUrl.includes("vardata")
    ) {
      return { status: 200, body: "[]" };
    }
    return { status: 200, body: DEMO_FLAG_BODY };
  },
};

export function AmplitudeE2eLab() {
  const [identityStatus, setIdentityStatus] = useState("(idle)");
  const [revenueStatus, setRevenueStatus] = useState("(idle)");
  const [groupStatus, setGroupStatus] = useState("(idle)");
  const [screenStatus, setScreenStatus] = useState("(idle)");
  const [healthStatus, setHealthStatus] = useState("(idle)");
  const [recordsStatus, setRecordsStatus] = useState("(idle)");
  const [clientStatus, setClientStatus] = useState("(idle)");
  const [stressStatus, setStressStatus] = useState("(idle)");
  const [analyticsStatus, setAnalyticsStatus] = useState("(idle)");
  const [variantStatus, setVariantStatus] = useState("(idle)");
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
            testID="e2e-opt-out-run"
            title="Opt-out + reset"
            onPress={() => {
              setOptOut(true);
              track("e2e_opted_out");
              setOptOut(false);
              reset();
              setIdentityStatus("ok:opt-out-reset");
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-revenue-run"
            title="Revenue"
            onPress={() => {
              const event = new Revenue()
                .setProductId("e2e-sku")
                .setPrice(1.25)
                .setQuantity(2);
              revenue(event);
              setRevenueStatus("ok:revenue");
            }}
            style={styles.flex1}
          />
        </View>

        <View style={styles.row}>
          <Button
            testID="e2e-group-run"
            title="Group"
            onPress={() => {
              setGroup("plan", "e2e");
              groupIdentify("plan", "e2e", new Identify().set("seat", "qa"));
              setGroupStatus("ok:group");
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
                  const found = getDryRunAnalyticsEvents().some((record) =>
                    record.payload.events.some(
                      (event) => event.event_type === "e2e_record_probe",
                    ),
                  );
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
              identify(new Identify().set("e2e_screen", "lab"));
              setAnalyticsStatus("ok:identified");
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-flush-run"
            title="Flush"
            onPress={() => {
              void flushWithResult()
                .then((result) => {
                  setAnalyticsStatus(
                    result.ok
                      ? `ok:flush=ok:sent=${result.sent}`
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
