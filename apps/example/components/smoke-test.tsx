import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import {
  Experiment,
  NitroAnalyticsStorage,
  NitroMemoryStorage,
  createInstance,
  prefetchNativeContext,
  track,
} from "react-native-nitro-amplitude";
import { Button, Card, Colors, StatusRow } from "./shared";

type LogEntry = {
  label: string;
  status: "pass" | "fail" | "running" | "skipped";
  detail?: string;
};

export function SmokeTestRunner() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState("Not run");

  const runAll = useCallback(async () => {
    const next: LogEntry[] = [];
    setSummary("Running");

    const run = async (label: string, fn: () => void | Promise<void>) => {
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

    setLogs(next);
    const passed = next.filter((entry) => entry.status === "pass").length;
    const failed = next.filter((entry) => entry.status === "fail").length;
    setSummary(
      `${passed}/${next.length} passed${failed ? ` · ${failed} failed` : ""}`,
    );
  }, []);

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
