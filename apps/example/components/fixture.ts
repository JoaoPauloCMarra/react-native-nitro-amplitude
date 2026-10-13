export const ANALYTICS_API_KEY = "nitro-amplitude-dry-run-analytics-key";
export const EXPERIMENT_API_KEY = "nitro-amplitude-dry-run-experiment-key";

export const fixtureHttpClient = {
  async request(requestUrl: string) {
    if (
      requestUrl.includes("/sdk/v2/flags") &&
      !requestUrl.includes("vardata")
    ) {
      return { status: 200, body: "[]" };
    }
    return {
      status: 200,
      body: JSON.stringify({ "demo-flag": { key: "on", value: "on" } }),
    };
  },
};

export function delay(millis: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, millis));
}
