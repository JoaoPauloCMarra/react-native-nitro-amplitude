import { BaseTransport } from "@amplitude/analytics-core";
import type { Payload, Response, Transport } from "@amplitude/analytics-core";
import { nitroHttpClient } from "../native/http";
import { assertNetworkEnabled } from "../network";

export class NitroTransport extends BaseTransport implements Transport {
  private readonly customHeaders: Record<string, string>;

  constructor(customHeaders: Record<string, string> = {}) {
    super();
    this.customHeaders = customHeaders;
  }

  async send(serverUrl: string, payload: Payload): Promise<Response | null> {
    assertNetworkEnabled();
    const response = await nitroHttpClient.request(
      serverUrl,
      "POST",
      {
        "Content-Type": "application/json",
        Accept: "*/*",
        ...this.customHeaders,
      },
      JSON.stringify(payload),
      30000,
    );
    try {
      return this.buildResponse(
        JSON.parse(response.body) as Record<string, unknown>,
      );
    } catch {
      return this.buildResponse({ code: response.status });
    }
  }
}

export const nitroTransport = new NitroTransport();
