import { FetchHttpClient } from "../experiment/transport/http";
import type { HttpClient, SimpleResponse } from "../experiment/types/transport";
import { assertNetworkEnabled } from "../network";

export class NitroHttpClient implements HttpClient {
  request(
    requestUrl: string,
    method: string,
    headers: Record<string, string>,
    data: string | null,
    timeoutMillis = 10000,
  ): Promise<SimpleResponse> {
    assertNetworkEnabled();
    return FetchHttpClient.request(
      requestUrl,
      method,
      headers,
      data ?? "",
      timeoutMillis,
    );
  }
}

export const nitroHttpClient = new NitroHttpClient();
