import { FetchTransport } from "@amplitude/analytics-core";
import type { Payload, Response } from "@amplitude/analytics-core";
import { assertNetworkEnabled } from "../network";

export class NetworkGuardedFetchTransport extends FetchTransport {
  async send(serverUrl: string, payload: Payload): Promise<Response | null> {
    assertNetworkEnabled();
    return await super.send(serverUrl, payload);
  }
}
