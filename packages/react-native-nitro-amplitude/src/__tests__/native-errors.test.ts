jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

type CompleteListener = (
  requestId: string,
  statusCode: number,
  body: string,
  error: string,
) => void;

const listeners: CompleteListener[] = [];
const enqueue = jest.fn();
let workerCreationError: Error | undefined;

type FakeWorker = {
  addOnComplete: jest.Mock;
  enqueue: jest.Mock;
  removeListener: jest.Mock;
};

function createFakeWorker(): FakeWorker {
  const removeListener = jest.fn();
  return {
    addOnComplete: jest.fn((listener: CompleteListener) => {
      listeners.push(listener);
      return removeListener;
    }),
    enqueue,
    removeListener,
  };
}

let currentWorker = createFakeWorker();

jest.mock("../native/hybrid", () => ({
  getAmplitudeWorker: () => {
    if (workerCreationError) {
      throw workerCreationError;
    }
    return currentWorker;
  },
}));

import {
  AmplitudeError,
  getAmplitudeErrorCode,
  parseNativeError,
} from "../errors";
import { NitroHttpClient } from "../native/http";

const IOS_DNS =
  "network_error|nsurl:-1003|NSURLErrorDomain|A server with the specified hostname could not be found.";
const ANDROID_DNS =
  'network_error|java.net.UnknownHostException|Unable to resolve host "api.lab.amplitude.com"';

async function failRequest(error: string): Promise<unknown> {
  listeners.length = 0;
  enqueue.mockReset();
  const client = new NitroHttpClient();
  const pending = client.request(
    "https://api.lab.amplitude.com/v1",
    "GET",
    {},
    null,
  );
  const requestId = enqueue.mock.calls[0]?.[0] as string;
  for (const listener of listeners) listener(requestId, 0, "", error);
  return pending.then(
    () => undefined,
    (caught: unknown) => caught,
  );
}

describe("parseNativeError", () => {
  it("returns the bare code without details", () => {
    expect(parseNativeError("network_error")).toEqual({
      nativeCode: "network_error",
    });
    expect(parseNativeError("NitroAmplitude: queue_full")).toEqual({
      nativeCode: "queue_full",
    });
  });

  it("strips the Nitro function name prefix before NitroAmplitude:", () => {
    expect(
      parseNativeError(
        "HybridAmplitudeWorker.enqueue: NitroAmplitude: queue_full",
      ),
    ).toEqual({ nativeCode: "queue_full" });
  });

  it("parses details only for network_error", () => {
    expect(parseNativeError("invalid_url|x|y")).toEqual({
      nativeCode: "invalid_url",
    });
    expect(parseNativeError("third party | pipe | text")).toEqual({
      nativeCode: "third party ",
    });
    expect(parseNativeError("timeout|x")).toEqual({ nativeCode: "timeout" });
  });

  it("parses the iOS shape", () => {
    expect(parseNativeError(IOS_DNS)).toEqual({
      nativeCode: "network_error",
      details: {
        code: -1003,
        domain: "NSURLErrorDomain",
        description: "A server with the specified hostname could not be found.",
      },
    });
  });

  it("parses the Android shape", () => {
    expect(parseNativeError(ANDROID_DNS)).toEqual({
      nativeCode: "network_error",
      details: {
        exception: "java.net.UnknownHostException",
        description: 'Unable to resolve host "api.lab.amplitude.com"',
      },
    });
  });

  it("omits a non numeric iOS code and tolerates missing fields", () => {
    expect(
      parseNativeError("network_error|nsurl:abc|Domain|x").details,
    ).toEqual({
      domain: "Domain",
      description: "x",
    });
    expect(
      parseNativeError("network_error|java.io.IOException|").details,
    ).toEqual({
      exception: "java.io.IOException",
    });
    expect(parseNativeError("network_error|").details).toBeUndefined();
  });
});

describe("worker error codes", () => {
  it("maps invalid_request to a network error with a bare nativeCode", () => {
    const raw =
      "HybridAmplitudeWorker.enqueue: NitroAmplitude: invalid_request";
    expect(parseNativeError(raw)).toEqual({ nativeCode: "invalid_request" });
    expect(getAmplitudeErrorCode(new Error(raw))).toBe("network_error");
  });

  it("maps adapter_unavailable to native_unavailable", () => {
    expect(parseNativeError("adapter_unavailable")).toEqual({
      nativeCode: "adapter_unavailable",
    });
    expect(getAmplitudeErrorCode(new Error("adapter_unavailable"))).toBe(
      "native_unavailable",
    );
  });
});

describe("getAmplitudeErrorCode with native detail", () => {
  it.each([
    ["network_error", "network_error"],
    ["invalid_url|x", "network_error"],
    ["cancelled|x", "network_error"],
    ["invalid_http_response|x", "network_error"],
    ["NitroAmplitude: queue_full", "network_error"],
    [
      "HybridAmplitudeWorker.enqueue: NitroAmplitude: queue_full",
      "network_error",
    ],
    ["some library | network issue", "network_error"],
    ["Failed | to read storage", "storage_error"],
    ["Nitro module | missing", "native_unavailable"],
    ["native_http_exception|x", "network_error"],
    ["timeout|x", "timeout"],
    [IOS_DNS, "network_error"],
    [ANDROID_DNS, "network_error"],
  ])("maps %s", (raw, expected) => {
    expect(getAmplitudeErrorCode(new Error(raw))).toBe(expected);
  });
});

describe("NitroHttpClient native failures", () => {
  it("keeps the bare message and exposes iOS detail", async () => {
    const error = await failRequest(IOS_DNS);
    expect(error).toBeInstanceOf(AmplitudeError);
    const amplitudeError = error as AmplitudeError;
    expect(amplitudeError.code).toBe("network_error");
    expect(amplitudeError.message).toBe("network_error");
    expect(amplitudeError.nativeCode).toBe("network_error");
    expect(amplitudeError.details).toEqual({
      code: -1003,
      domain: "NSURLErrorDomain",
      description: "A server with the specified hostname could not be found.",
    });
    expect((amplitudeError.cause as Error).message).toBe(IOS_DNS);
  });

  it("exposes Android detail", async () => {
    const amplitudeError = (await failRequest(ANDROID_DNS)) as AmplitudeError;
    expect(amplitudeError.message).toBe("network_error");
    expect(amplitudeError.details?.exception).toBe(
      "java.net.UnknownHostException",
    );
  });

  it.each([
    "cancelled",
    "queue_full",
    "invalid_url",
    "invalid_http_response",
    "native_http_exception",
  ])(
    "keeps code network_error and exposes nativeCode %s",
    async (nativeCode) => {
      const amplitudeError = (await failRequest(nativeCode)) as AmplitudeError;
      expect(amplitudeError.code).toBe("network_error");
      expect(amplitudeError.message).toBe(nativeCode);
      expect(amplitudeError.nativeCode).toBe(nativeCode);
      expect(amplitudeError.details).toBeUndefined();
    },
  );

  it("keeps timeout code and exposes nativeCode", async () => {
    const amplitudeError = (await failRequest("timeout")) as AmplitudeError;
    expect(amplitudeError.code).toBe("timeout");
    expect(amplitudeError.nativeCode).toBe("timeout");
  });

  it("sets nativeCode when enqueue throws queue_full", async () => {
    listeners.length = 0;
    enqueue.mockReset();
    enqueue.mockImplementation(() => {
      throw new Error(
        "HybridAmplitudeWorker.enqueue: NitroAmplitude: queue_full",
      );
    });
    const error = await new NitroHttpClient()
      .request("https://api.lab.amplitude.com/v1", "GET", {}, null)
      .catch((caught: unknown) => caught);
    const amplitudeError = error as AmplitudeError;
    expect(amplitudeError.code).toBe("network_error");
    expect(amplitudeError.nativeCode).toBe("queue_full");
    expect(amplitudeError.details).toBeUndefined();
    expect(amplitudeError.cause).toBeInstanceOf(Error);
  });

  it("wraps a worker creation failure in AmplitudeError", async () => {
    workerCreationError = new Error(
      "Couldn't find the native module AmplitudeWorker",
    );
    try {
      const error = await new NitroHttpClient()
        .request("https://api.lab.amplitude.com/v1", "GET", {}, null)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AmplitudeError);
      expect((error as AmplitudeError).code).toBe("native_unavailable");
      expect((error as AmplitudeError).cause).toBe(workerCreationError);
    } finally {
      workerCreationError = undefined;
    }
  });

  it("installs the completion listener again after addOnComplete throws", async () => {
    listeners.length = 0;
    enqueue.mockReset();
    currentWorker = createFakeWorker();
    currentWorker.addOnComplete.mockImplementationOnce(() => {
      throw new Error("Nitro listener registration failed");
    });
    const client = new NitroHttpClient();

    const failed = await client
      .request("https://api.lab.amplitude.com/v1", "GET", {}, null)
      .catch((caught: unknown) => caught);
    expect(failed).toBeInstanceOf(AmplitudeError);
    expect(enqueue).not.toHaveBeenCalled();

    const pending = client.request(
      "https://api.lab.amplitude.com/v1",
      "GET",
      {},
      null,
    );
    expect(currentWorker.addOnComplete).toHaveBeenCalledTimes(2);
    const requestId = enqueue.mock.calls[0]?.[0] as string;
    for (const listener of listeners) listener(requestId, 200, "ok", "");
    await expect(pending).resolves.toEqual({ status: 200, body: "ok" });
  });

  it("removes the previous listener when the worker instance changes", async () => {
    listeners.length = 0;
    enqueue.mockReset();
    const first = createFakeWorker();
    currentWorker = first;
    const client = new NitroHttpClient();
    const run = async (worker: FakeWorker) => {
      currentWorker = worker;
      const pending = client.request(
        "https://api.lab.amplitude.com/v1",
        "GET",
        {},
        null,
      );
      const requestId = enqueue.mock.calls[
        enqueue.mock.calls.length - 1
      ]?.[0] as string;
      listeners[listeners.length - 1]?.(requestId, 200, "ok", "");
      await pending;
    };

    await run(first);
    await run(first);
    expect(first.addOnComplete).toHaveBeenCalledTimes(1);
    expect(first.removeListener).not.toHaveBeenCalled();

    const second = createFakeWorker();
    await run(second);
    expect(first.removeListener).toHaveBeenCalledTimes(1);
    expect(second.addOnComplete).toHaveBeenCalledTimes(1);
  });
});
