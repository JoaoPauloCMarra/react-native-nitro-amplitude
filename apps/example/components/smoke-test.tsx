import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { prefetchNativeContext, VERSION } from "react-native-nitro-amplitude";
import { Button, Card, Colors, StatusRow } from "./shared";

type LogEntry = {
  label: string;
  status: "pass" | "fail" | "running" | "skipped";
  detail?: string;
};

export function SmokeTestRunner() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState("Not run");

  const runAll = useCallback(() => {
    const next: LogEntry[] = [];

    const run = (label: string, fn: () => void) => {
      try {
        fn();
        next.push({ label, status: "pass" });
      } catch (error) {
        next.push({
          label,
          status: "fail",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    };

    run("VERSION export", () => {
      if (!VERSION.startsWith("0.")) {
        throw new Error(`unexpected VERSION: ${VERSION}`);
      }
    });

    run("prefetchNativeContext", () => {
      prefetchNativeContext();
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
      <Button testID="smoke-run-all" title="Run All" onPress={runAll} />
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
