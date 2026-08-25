import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import {
  AmplitudeError,
  Experiment,
  NitroAnalyticsStorage,
  NitroMemoryStorage,
  assertNetworkEnabled,
  clearDryRunTransportRecords,
  createInstance,
  createMockAmplitudeClient,
  createMockExperimentClient,
  createNetworkTimingBuffer,
  createFakeExperimentStorage,
  DryRunHttpClient,
  getDryRunTransportRecords,
  getLastNativeError,
  getNativeStartupDiagnostics,
  getNetworkEnabled,
  getSafeDiagnostics,
  healthCheck,
  prefetchNativeContext,
  setNetworkEnabled,
  track,
  variantString,
} from "react-native-nitro-amplitude";
import { Button, Card, Colors, StatusRow } from "./shared";

type LogEntry = {
  label: string;
  status: "pass" | "fail" | "skipped";
  detail?: string;
};

export function SmokeTestRunner() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState("Not run");
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    if (running) return;
    const next: LogEntry[] = [];
    setRunning(true);
    setSummary("Running");

    const run = async (
      label: string,
      fn: () => void | Promise<void>,
      skipReason?: string,
    ) => {
      if (skipReason) {
        next.push({ label, status: "skipped", detail: skipReason });
        return;
      }
      try {
        await fn();
        next.push({ label, status: "pass" });
      } catch (error) {
        next.push({
          label,
          status: "fail",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    };

    await run("prefetchNativeContext", () => {
      prefetchNativeContext();
    });

    await run("create analytics instance", () => {
      const client = createInstance();
      if (typeof client.init !== "function") {
        throw new Error("analytics client missing init");
      }
    });

    await run("track event API", () => {
      track("nitro_amplitude_smoke", { source: "smoke-test" });
    });

    await run("Nitro analytics storage", async () => {
      const storage = new NitroAnalyticsStorage<{ ok: boolean }>("smoke");
      await storage.set("analytics", { ok: true });
      const value = await storage.get("analytics");
      await storage.reset();
      if (!value?.ok) {
        throw new Error("analytics storage did not round-trip");
      }
    });

    await run("Nitro experiment storage", async () => {
      const storage = new NitroMemoryStorage("smoke");
      await storage.put("variant", "on");
      const value = await storage.get("variant");
      await storage.reset();
      if (value !== "on") {
        throw new Error("experiment storage did not round-trip");
      }
    });

    await run("Experiment factory", () => {
      const client = Experiment.initialize("smoke-deployment-key", {
        instanceName: "smoke",
        fetchOnStart: false,
        pollOnStart: false,
      });
      if (typeof client.variant !== "function") {
        throw new Error("experiment client missing variant");
      }
    });

    await run("Network controls and timing", async () => {
      const previousNetworkState = getNetworkEnabled();
      const timingBuffer = createNetworkTimingBuffer(1);
      timingBuffer.record({
        kind: "analytics",
        url: "https://example.invalid/smoke",
        method: "POST",
        startedAt: 0,
        finishedAt: 1,
        durationMillis: 1,
        status: 202,
      });
      if (timingBuffer.getTimings().length !== 1) {
        throw new Error("network timing buffer did not record a request");
      }

      clearDryRunTransportRecords();
      const dryRunHttpClient = new DryRunHttpClient();
      await dryRunHttpClient.request(
        "https://example.invalid/smoke",
        "POST",
        {},
        null,
      );
      if (getDryRunTransportRecords().length !== 1) {
        throw new Error("dry-run HTTP client did not record a request");
      }

      setNetworkEnabled(false);
      try {
        assertNetworkEnabled();
        throw new Error("disabled network did not reject the request");
      } catch (error) {
        if (!(error instanceof AmplitudeError)) {
          throw error;
        }
      } finally {
        setNetworkEnabled(previousNetworkState);
        clearDryRunTransportRecords();
      }
    });

    await run("Diagnostics and health check", async () => {
      const startup = getNativeStartupDiagnostics();
      const safe = getSafeDiagnostics();
      const health = await healthCheck();
      void getLastNativeError();
      if (
        typeof startup.nativeAvailable !== "boolean" ||
        typeof safe.networkEnabled !== "boolean" ||
        typeof health.ok !== "boolean" ||
        !Array.isArray(health.errors)
      ) {
        throw new Error("diagnostics returned an invalid public shape");
      }
    });

    await run("Testing helpers and typed variants", async () => {
      const fakeStorage = createFakeExperimentStorage({ flag: "on" });
      if ((await fakeStorage.get("flag")) !== "on") {
        throw new Error("fake experiment storage did not return its fixture");
      }

      const mockAnalytics = createMockAmplitudeClient();
      await mockAnalytics.init("smoke", "smoke-user").promise;
      if (mockAnalytics.getUserId() !== "smoke-user") {
        throw new Error("mock analytics client did not retain its user");
      }

      const mockExperiment = createMockExperimentClient({
        flag: { value: "on" },
      });
      if (variantString(mockExperiment, "flag", "off") !== "on") {
        throw new Error("typed variant helper did not resolve its fixture");
      }
    });

    setLogs(next);
    const passed = next.filter((entry) => entry.status === "pass").length;
    const failed = next.filter((entry) => entry.status === "fail").length;
    const skipped = next.filter((entry) => entry.status === "skipped").length;
    setSummary(
      `${passed} passed · ${failed} failed · ${skipped} skipped · ${
        next.length
      } total`,
    );
    setRunning(false);
  }, [running]);

  return (
    <Card
      title="Smoke Test"
      subtitle="Native Nitro Amplitude sanity checks"
      indicatorColor={Colors.primary}
    >
      <StatusRow testID="smoke-summary" label="Summary" value={summary} />
      <Button
        testID="smoke-run-all"
        title="Run All"
        disabled={running}
        onPress={() => {
          void runAll();
        }}
      />
      <View style={{ gap: 8, marginTop: 12 }}>
        {logs.map((entry) => (
          <View key={entry.label}>
            <Text
              style={{
                color: entry.status === "fail" ? Colors.danger : Colors.success,
              }}
            >
              {entry.status.toUpperCase()}: {entry.label}
            </Text>
            {entry.detail ? (
              <Text style={{ color: Colors.muted, fontSize: 12 }}>
                {entry.detail}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </Card>
  );
}
