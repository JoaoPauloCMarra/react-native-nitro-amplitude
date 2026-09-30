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
