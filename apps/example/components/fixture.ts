export const ANALYTICS_API_KEY = "nitro-amplitude-dry-run-analytics-key";
export const EXPERIMENT_API_KEY = "nitro-amplitude-dry-run-experiment-key";

const DEFAULT_VARIANTS = { "demo-flag": { key: "on", value: "on" } };

type FixtureResponse = { status: number; body: string };

export function createFixtureHttpClient(
  variants: Record<string, unknown> = DEFAULT_VARIANTS,
  interceptVariants?: (requestUrl: string) => FixtureResponse | undefined,
) {
  return {
    async request(requestUrl: string): Promise<FixtureResponse> {
      if (
        requestUrl.includes("/sdk/v2/flags") &&
        !requestUrl.includes("vardata")
      ) {
        return { status: 200, body: "[]" };
      }
      const intercepted = interceptVariants?.(requestUrl);
      if (intercepted) {
        return intercepted;
      }
      return { status: 200, body: JSON.stringify(variants) };
    },
  };
}

export const fixtureHttpClient = createFixtureHttpClient();

export function fixtureEndpoint(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${endpoint}`;
}

export function delay(millis: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, millis));
}
