jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("../native/context", () => ({
  EXPERIMENT_CONTEXT_OPTIONS: {},
  getNativeApplicationContext: () => ({
    version: "2.4.0",
    platform: "iOS",
    language: "en-US",
    country: "US",
    osName: "iOS",
    osVersion: "18.2",
    deviceBrand: "Apple",
    deviceManufacturer: "Apple",
    deviceModel: "iPhone17,1",
    carrier: "Carrier",
    idfv: "vendor-id",
  }),
}));

import { AnalyticsConnector } from "@amplitude/analytics-connector";
import { Platform } from "react-native";
import { ExperimentClient } from "../experiment/experimentClient";
import { DefaultUserProvider } from "../experiment/integration/default";

const mockPlatform = Platform as { OS: string };

afterEach(() => {
  mockPlatform.OS = "ios";
});

test("maps native context to ExperimentUser targeting keys", async () => {
  const user = await new DefaultUserProvider(null).getUser();

  expect(user).toEqual({
    version: "2.4.0",
    platform: "iOS",
    language: "en-US",
    country: "US",
    os: "iOS 18.2",
    device_brand: "Apple",
    device_manufacturer: "Apple",
    device_model: "iPhone17,1",
    carrier: "Carrier",
  });
});

test("keeps explicit user fields over mapped context", async () => {
  const provider = new DefaultUserProvider({
    getUser: async () => ({ user_id: "u1", device_model: "custom" }),
  });

  const user = await provider.getUser();

  expect(user.user_id).toBe("u1");
  expect(user.device_model).toBe("custom");
  expect(user.os).toBe("iOS 18.2");
  expect(provider.getUserSync().os).toBe("iOS 18.2");
});

test("maps web connector context to ExperimentUser keys", async () => {
  mockPlatform.OS = "web";
  const contextProvider =
    AnalyticsConnector.getInstance("context").applicationContextProvider;
  contextProvider.versionName = "9.9.9";
  const provider = new DefaultUserProvider(null);

  const user = await provider.getUser();

  expect(user.version).toBe("9.9.9");
  expect(user.platform).toBe("Web");
  expect(user).not.toHaveProperty("versionName");
  expect(user).not.toHaveProperty("deviceModel");
});

test("start() without a user keeps the user set by setUser", async () => {
  mockPlatform.OS = "web";
  let sentUser: { user_id?: string } | undefined;
  const client = new ExperimentClient("test-deployment-key", {
    automaticExposureTracking: false,
    fetchOnStart: true,
    pollOnStart: false,
    httpClient: {
      request: async (url, _method, headers) => {
        if (headers["X-Amp-Exp-User"]) {
          sentUser = JSON.parse(
            Buffer.from(headers["X-Amp-Exp-User"], "base64url").toString(),
          );
        }
        return { status: 200, body: url.includes("flags") ? "[]" : "{}" };
      },
    },
  });
  try {
    await client.cacheReady();
    client.setUser({ user_id: "user-123" });
    await client.start();

    expect(client.getUser().user_id).toBe("user-123");
    expect(sentUser?.user_id).toBe("user-123");
  } finally {
    client.stop();
  }
});

test("local evaluation sees a custom userProvider before start()", async () => {
  mockPlatform.OS = "web";
  const flag = {
    key: "provider-flag",
    metadata: { evaluationMode: "local" },
    variants: {
      on: { key: "on", value: "on" },
      off: { key: "off", value: "off" },
    },
    segments: [
      {
        conditions: [
          [
            {
              selector: ["context", "user", "user_id"],
              op: "is",
              values: ["p"],
            },
          ],
        ],
        variant: "on",
      },
      { variant: "off" },
    ],
  };
  const client = new ExperimentClient("test-deployment-key", {
    automaticExposureTracking: false,
    fetchOnStart: false,
    pollOnStart: false,
    initialFlags: JSON.stringify([flag]),
    userProvider: { getUser: async () => ({ user_id: "p" }) },
    httpClient: { request: async () => ({ status: 200, body: "{}" }) },
  });
  try {
    await client.cacheReady();
    await client.fetch();

    expect(client.variant("provider-flag").value).toBe("on");
  } finally {
    client.stop();
  }
});
