/**
 * @packageDocumentation
 * @internal
 */

import {
  safeGlobal,
  HttpClient as CoreHttpClient,
  HttpRequest,
  HttpResponse,
} from "@amplitude/experiment-core";
import unfetch from "unfetch";

import { HttpClient, SimpleResponse } from "../types/transport";

const getFetch = () => safeGlobal.fetch || unfetch;

type AbortControllerLike = {
  signal: AbortSignal;
  abort(): void;
};

type GlobalScopeWithAbortController = typeof globalThis & {
  AbortController?: new () => AbortControllerLike;
};

const getAbortController = (): AbortControllerLike | undefined => {
  const scope = safeGlobal as GlobalScopeWithAbortController;
  return typeof scope.AbortController === "function"
    ? new scope.AbortController()
    : undefined;
};

const timeout = (
  promise: Promise<SimpleResponse>,
  timeoutMillis?: number,
  abortController?: AbortControllerLike,
): Promise<SimpleResponse> => {
  if (timeoutMillis == null || timeoutMillis <= 0) {
    return promise;
  }
  return new Promise(function (resolve, reject) {
    const timeoutHandle = safeGlobal.setTimeout(function () {
      abortController?.abort();
      reject(Error("Request timeout after " + timeoutMillis + " milliseconds"));
    }, timeoutMillis);
    promise.then(
      (value) => {
        safeGlobal.clearTimeout(timeoutHandle);
        resolve(value);
      },
      (error) => {
        safeGlobal.clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
};

const _request = (
  requestUrl: string,
  method: string,
  headers: Record<string, string>,
  data: string,
  timeoutMillis?: number,
): Promise<SimpleResponse> => {
  const abortController = getAbortController();
  const call = async () => {
    const response = await getFetch()(requestUrl, {
      method: method,
      headers: headers,
      body: data,
      signal: abortController?.signal,
    });
    const simpleResponse: SimpleResponse = {
      status: response.status,
      body: await response.text(),
    };
    return simpleResponse;
  };
  return timeout(call(), timeoutMillis, abortController);
};

/**
 * Wrap the exposed HttpClient in a CoreClient implementation to work with
 * FlagsApi and EvaluationApi.
 */
export class WrapperClient implements CoreHttpClient {
  private readonly client: HttpClient;
  constructor(client: HttpClient) {
    this.client = client;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    return await this.client.request(
      request.requestUrl,
      request.method,
      request.headers,
      null,
      request.timeoutMillis,
    );
  }
}

export const FetchHttpClient: HttpClient = { request: _request };
