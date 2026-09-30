import { FetchTransport } from "@amplitude/analytics-core";
import type { Payload, Response } from "@amplitude/analytics-core";
import { assertNetworkEnabled, markNetworkGuardedTransport } from "../network";

export class NetworkGuardedFetchTransport extends FetchTransport {
  constructor() {
    super();
    markNetworkGuardedTransport(this);
  }

  override async send(
    serverUrl: string,
    payload: Payload,
  ): Promise<Response | null> {
    assertNetworkEnabled();
    return await super.send(serverUrl, payload);
  }
}
