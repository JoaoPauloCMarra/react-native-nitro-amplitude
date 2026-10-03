const http = require("node:http");

const maxRequestBytes = 16 * 1024;
const maxDelayMillis = 5000;
const demoFlagVariants = { "demo-flag": { key: "on", value: "on" } };

function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function parseBatch(body) {
  try {
    const batch = JSON.parse(body);
    if (
      batch &&
      typeof batch.api_key === "string" &&
      batch.api_key.length > 0 &&
      Array.isArray(batch.events) &&
      batch.events.length > 0
    ) {
      return batch;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function handleRequest(request, response, timers) {
  let body = "";
  let tooLarge = false;
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    if (tooLarge) return;
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > maxRequestBytes) {
      tooLarge = true;
      json(response, 413, { ok: false, fixture: true, status: 413 });
    }
  });
  request.on("end", () => {
    if (tooLarge) return;
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health" && request.method === "GET") {
      json(response, 200, {
        ok: true,
        fixture: "nitro-amplitude-replay",
      });
      return;
    }
    if (url.pathname === "/echo" && request.method === "POST") {
      json(response, 200, {
        ok: true,
        fixture: "nitro-amplitude-replay",
        method: request.method,
        path: url.pathname,
        body,
      });
      return;
    }
    if (url.pathname === "/status/503" && request.method === "GET") {
      json(response, 503, {
        ok: false,
        fixture: "nitro-amplitude-replay",
        status: 503,
      });
      return;
    }
    const delay = /^\/delay\/(\d+)$/.exec(url.pathname);
    if (delay && request.method === "GET") {
      const delayMillis = Math.min(Number(delay[1]), maxDelayMillis);
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (response.destroyed || response.writableEnded) return;
        json(response, 200, {
          ok: true,
          fixture: "nitro-amplitude-replay",
          delayMillis,
        });
      }, delayMillis);
      timers.add(timer);
      return;
    }
    if (url.pathname === "/2/httpapi" && request.method === "POST") {
      const batch = parseBatch(body);
      if (!batch) {
        json(response, 400, { code: 400, error: "invalid batch" });
        return;
      }
      json(response, 200, {
        code: 200,
        events_ingested: batch.events.length,
      });
      return;
    }
    if (url.pathname === "/2/httpapi/503" && request.method === "POST") {
      json(response, 503, { code: 503 });
      return;
    }
    if (
      url.pathname.startsWith("/sdk/v2/") &&
      (request.method === "GET" || request.method === "POST")
    ) {
      const authorization = request.headers.authorization ?? "";
      if (!/^Api-Key \S+$/.test(authorization)) {
        json(response, 401, { error: "missing deployment key" });
        return;
      }
      if (url.pathname === "/sdk/v2/flags") {
        json(response, 200, []);
        return;
      }
      if (url.pathname === "/sdk/v2/vardata") {
        json(response, 200, demoFlagVariants);
        return;
      }
    }
    json(response, 404, { ok: false, fixture: true, status: 404 });
  });
}

function formatHost(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function createExampleReplayHttpFixture({
  bindHost = "127.0.0.1",
  advertiseHost = bindHost,
  port = 0,
} = {}) {
  const timers = new Set();
  const server = http.createServer((request, response) =>
    handleRequest(request, response, timers),
  );

  return {
    async listen() {
      if (!server.listening) {
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve();
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(port, bindHost);
        });
      }
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Replay fixture did not bind to a TCP address");
      }
      return {
        bindHost,
        port: address.port,
        baseUrl: `http://${formatHost(advertiseHost)}:${address.port}`,
      };
    },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections?.();
      });
    },
  };
}

function parseArgs(argv) {
  const options = {
    bindHost: "127.0.0.1",
    advertiseHost: "127.0.0.1",
    port: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") {
      return { help: true };
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    if (flag === "--bind") options.bindHost = value;
    else if (flag === "--advertise-host") options.advertiseHost = value;
    else if (flag === "--port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("--port must be an integer from 0 to 65535");
      }
      options.port = port;
    } else {
      throw new Error(`Unknown replay fixture option: ${flag}`);
    }
    index += 1;
  }
  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(
        "Usage: bun scripts/example-replay-http-fixture.js [--bind <address>] [--advertise-host <device-reachable-host>] [--port <port>]\n",
      );
    } else {
      const fixture = createExampleReplayHttpFixture(options);
      fixture
        .listen()
        .then(({ baseUrl, bindHost }) => {
          process.stdout.write(
            `Replay fixture listening at ${baseUrl} (bound to ${bindHost})\n`,
          );
          const stop = () => {
            void fixture.close().finally(() => {
              process.exitCode = 0;
            });
          };
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
        })
        .catch((error) => {
          process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`,
          );
          process.exitCode = 1;
        });
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { createExampleReplayHttpFixture, parseArgs };
