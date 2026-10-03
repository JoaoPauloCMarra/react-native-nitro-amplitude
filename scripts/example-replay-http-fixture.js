const http = require("node:http");

const maxRequestBytes = 16 * 1024;

function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function handleRequest(request, response) {
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
  const server = http.createServer(handleRequest);

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
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
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
