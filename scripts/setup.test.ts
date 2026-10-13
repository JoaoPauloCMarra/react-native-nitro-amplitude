import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

type SetupDependencies = {
  commandExists: (command: string) => boolean;
  execCommand: (command: string, options?: Record<string, unknown>) => boolean;
  log: (message: string) => void;
  console: { log: (message?: unknown) => void };
};

type SetupModule = {
  exports: {
    main?: (dependencies: SetupDependencies) => Promise<number>;
  };
};

async function runSetupWithFailure(failedCommand: string) {
  const filename = path.join(__dirname, "setup.js");
  const source = readFileSync(filename, "utf8");
  const commands: string[] = [];
  const messages: string[] = [];
  const setupModule: SetupModule = { exports: {} };
  const setupRequire = Object.assign(
    (name: string): unknown => {
      if (name === "child_process") return { execSync: () => undefined };
      if (name === "path") return path;
      throw new Error(`unexpected setup dependency: ${name}`);
    },
    { main: {} },
  );
  const output = {
    log: (message?: unknown) => messages.push(String(message ?? "")),
  };

  runInNewContext(source, {
    __dirname,
    console: output,
    exports: setupModule.exports,
    module: setupModule,
    process: { platform: "linux" },
    require: setupRequire,
  });

  const dependencies: SetupDependencies = {
    commandExists: () => true,
    execCommand(command) {
      commands.push(command);
      return command !== failedCommand;
    },
    log(message) {
      messages.push(message);
    },
    console: output,
  };

  const status = await setupModule.exports.main?.(dependencies);

  return {
    commands: commands.filter((command) => command !== "command -v bun"),
    messages,
    status,
  };
}

test.each([
  ["bun install", ["bun install"], "Failed to install dependencies"],
  [
    "bun run codegen",
    ["bun install", "bun run codegen"],
    "Failed to generate Nitro bindings",
  ],
  [
    "bun run build",
    ["bun install", "bun run codegen", "bun run build"],
    "Failed to build library",
  ],
])(
  "setup stops with a nonzero status when %s fails",
  async (failedCommand, expectedCommands, expectedError) => {
    const result = await runSetupWithFailure(failedCommand as string);

    expect(result.status).toBe(1);
    expect(result.commands).toEqual(expectedCommands);
    expect(result.messages.join("\n")).toContain(expectedError);
    expect(result.messages.join("\n")).not.toContain("Setup complete");
  },
);
