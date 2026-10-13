jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const request = jest.fn();
jest.mock("../native/http", () => ({
  nitroHttpClient: { request: (...args: unknown[]) => request(...args) },
}));

import { Status } from "@amplitude/analytics-core";
import { NitroTransport } from "../analytics/nitro-transport";

const URL = "https://api2.amplitude.com/2/httpapi";
const payload = { api_key: "key", events: [] };

describe("NitroTransport status mapping", () => {
  beforeEach(() => request.mockReset());

  test("uses the code in the Amplitude response body", async () => {
    request.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ code: 200, events_ingested: 2 }),
    });
    const response = await new NitroTransport().send(URL, payload);
    expect(response?.status).toBe(Status.Success);
    expect(response?.statusCode).toBe(200);
  });

  test.each([
    [413, Status.PayloadTooLarge],
    [429, Status.RateLimit],
    [400, Status.Invalid],
    [503, Status.Failed],
  ])("maps a %i body code", async (code, status) => {
    request.mockResolvedValue({
      status: code,
      body: JSON.stringify({ code }),
    });
    const response = await new NitroTransport().send(URL, payload);
    expect(response?.status).toBe(status);
  });

  test("falls back to the HTTP status for a non-JSON body", async () => {
    request.mockResolvedValue({ status: 502, body: "<html>Bad Gateway</html>" });
    const response = await new NitroTransport().send(URL, payload);
    expect(response?.status).toBe(Status.Failed);
    expect(response?.statusCode).toBe(502);
  });

  test("falls back to the HTTP status when a JSON body has no code", async () => {
    request.mockResolvedValue({
      status: 401,
      body: JSON.stringify({ message: "Unauthorized" }),
    });
    const response = await new NitroTransport().send(URL, payload);
    expect(response?.status).toBe(Status.Invalid);
    expect(response?.statusCode).toBe(401);
  });

  test("treats an empty JSON object on a 200 as success", async () => {
    request.mockResolvedValue({ status: 200, body: "{}" });
    const response = await new NitroTransport().send(URL, payload);
    expect(response?.status).toBe(Status.Success);
  });
});
