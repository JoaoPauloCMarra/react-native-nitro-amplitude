import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Glob } from "bun";

type JsonRecord = Record<string, unknown>;
type DependencyMap = Record<string, string>;

const projectRoot = import.meta.dir + "/..";

function asRecord(value: unknown): JsonRecord {
  return value != null && typeof value === "object"
    ? (value as JsonRecord)
    : {};
}

function asDependencies(value: unknown): DependencyMap {
  const entries = Object.entries(asRecord(value)).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function run(
  command: string[],
  cwd: string,
): { exitCode: number; output: string } {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  };
}

async function main(): Promise<void> {
  const packageFiles = Array.from(
    new Glob("packages/*/package.json").scanSync({ cwd: projectRoot }),
  );
  if (packageFiles.length !== 1) {
    throw new Error(
      `Expected one package manifest, found ${packageFiles.length}.`,
    );
  }

  const packageRelativePath = packageFiles[0];
  const packageManifestPath = join(projectRoot, packageRelativePath);
  const packageRoot = dirname(packageManifestPath);
  const packageManifest = JSON.parse(
    await Bun.file(packageManifestPath).text(),
  ) as JsonRecord;
  const packageName = String(packageManifest.name);
  const sourceDirectory = packageManifestPath.replace(
    /\/package\.json$/,
    "/src",
  );
  const sourceEntry = join(sourceDirectory, "index.ts");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "nitro-rn087-types-"));
  const consumerSubpaths = [
    "./analytics",
    "./experiment",
    "./network",
    "./testing",
  ];
  const reactTypePaths = {
    react: [join(temporaryRoot, "node_modules/@types/react/index.d.ts")],
    "react/*": [join(temporaryRoot, "node_modules/@types/react/*")],
    "react-native": [
      join(
        temporaryRoot,
        "node_modules/react-native/types_generated/index.d.ts",
      ),
    ],
    "react-native/*": [join(temporaryRoot, "node_modules/react-native/*")],
  };
  const compilerOptions = {
    allowSyntheticDefaultImports: true,
    baseUrl: temporaryRoot,
    esModuleInterop: true,
    ignoreDeprecations: "6.0",
    jsx: "react-native",
    module: "ESNext",
    moduleResolution: "bundler",
    noEmit: true,
    noFallthroughCasesInSwitch: true,
    noImplicitReturns: true,
    noImplicitOverride: true,
    noUncheckedIndexedAccess: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    target: "ES2020",
    types: ["node", "react", "react-native"],
  };

  try {
    const dependencies: DependencyMap = {
      ...asDependencies(packageManifest.dependencies),
      ...asDependencies(packageManifest.peerDependencies),
      ...asDependencies(packageManifest.devDependencies),
      "@types/node": "^24.0.0",
      "@types/react": "~19.2.18",
      react: "19.2.3",
      "react-native": "0.87.0",
      "react-native-nitro-modules": "0.37.1",
      typescript: "6.0.3",
    };

    await Bun.write(
      join(temporaryRoot, "package.json"),
      JSON.stringify(
        {
          name: `${packageName}-rn087-typecheck`,
          private: true,
          dependencies,
        },
        null,
        2,
      ),
    );
    await Bun.write(
      join(temporaryRoot, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            ...compilerOptions,
            paths: {
              [packageName]: [sourceEntry],
              [`${packageName}/package.json`]: [packageManifestPath],
              [`${packageName}/*`]: [`${sourceDirectory}/*`],
              ...reactTypePaths,
            },
          },
          include: [sourceEntry, `${sourceDirectory}/**/*.d.ts`],
        },
        null,
        2,
      ),
    );

    const install = run(
      ["bun", "install", "--ignore-scripts", "--no-progress"],
      temporaryRoot,
    );
    if (install.exitCode !== 0) {
      throw new Error(
        `RN 0.87 compatibility dependencies failed to install:\n${install.output}`,
      );
    }

    const typecheck = run(
      ["bun", "x", "tsc", "--noEmit", "-p", "tsconfig.json"],
      temporaryRoot,
    );
    if (typecheck.exitCode !== 0) {
      throw new Error(
        `RN 0.87 Strict TypeScript compatibility failed:\n${typecheck.output}`,
      );
    }

    console.log(
      `${packageName} passes the RN 0.87 source TypeScript compatibility check.`,
    );

    const packageExports = asRecord(packageManifest.exports);
    const consumerExports = [
      { specifier: packageName, exportKey: "." },
      ...consumerSubpaths.map((subpath) => ({
        specifier: `${packageName}${subpath.slice(1)}`,
        exportKey: subpath,
      })),
    ];
    const declarationEntries: { specifier: string; path: string }[] = [];
    for (const { specifier, exportKey } of consumerExports) {
      const declarationPath = asRecord(packageExports[exportKey]).types;
      if (typeof declarationPath !== "string") {
        throw new Error(
          `RN 0.87 packed consumer check requires a types export for ${specifier}.`,
        );
      }
      const declarationFile = join(packageRoot, declarationPath);
      if (!(await Bun.file(declarationFile).exists())) {
        throw new Error(
          `RN 0.87 packed consumer check requires built declarations; ${declarationPath} is missing. Run bun run build before typecheck:rn087.`,
        );
      }
      declarationEntries.push({ specifier, path: declarationPath });
    }

    const tarballName = `${packageName.replace(/^@/, "").replace(/\//g, "-")}-${String(packageManifest.version)}.tgz`;
    const tarballPath = join(temporaryRoot, tarballName);
    const pack = run(
      [
        "bun",
        "pm",
        "pack",
        "--ignore-scripts",
        "--filename",
        tarballPath,
        "--quiet",
      ],
      packageRoot,
    );
    if (pack.exitCode !== 0) {
      throw new Error(
        `RN 0.87 consumer package tarball failed to create:\n${pack.output}`,
      );
    }

    if (!(await Bun.file(tarballPath).exists())) {
      throw new Error(
        `RN 0.87 consumer package tarball was not created at ${tarballPath}.\n${pack.output}`,
      );
    }

    dependencies[packageName] = `file:./${tarballName}`;
    await Bun.write(
      join(temporaryRoot, "package.json"),
      JSON.stringify(
        {
          name: `${packageName}-rn087-typecheck`,
          private: true,
          dependencies,
        },
        null,
        2,
      ),
    );
    const installTarball = run(
      ["bun", "install", "--ignore-scripts", "--no-progress"],
      temporaryRoot,
    );
    if (installTarball.exitCode !== 0) {
      throw new Error(
        `RN 0.87 packed consumer dependencies failed to install:\n${installTarball.output}`,
      );
    }

    const consumerFile = join(temporaryRoot, "consumer.ts");
    await Bun.write(
      consumerFile,
      [
        `import { createAmplitudeClient, createInstance, Experiment } from ${JSON.stringify(packageName)};`,
        `import { init as analyticsInit } from ${JSON.stringify(`${packageName}/analytics`)};`,
        `import { Experiment as ExperimentSubpath, type ExperimentConfig, type VariantFreshness } from ${JSON.stringify(`${packageName}/experiment`)};`,
        `import { createNetworkTimingBuffer, setNetworkEnabled, type AmplitudeNetworkTimingBuffer } from ${JSON.stringify(`${packageName}/network`)};`,
        `import { createFakeExperimentStorage } from ${JSON.stringify(`${packageName}/testing`)};`,
        "",
        "const client = createInstance();",
        'const combined = createAmplitudeClient({ analyticsApiKey: "analytics-key" });',
        'const rootExperiment = Experiment.initialize("deployment-key");',
        'const subpathExperiment = ExperimentSubpath.initialize("deployment-key");',
        'const config: ExperimentConfig = { instanceName: "consumer" };',
        'const freshness: VariantFreshness = "fresh";',
        "const timingBuffer: AmplitudeNetworkTimingBuffer = createNetworkTimingBuffer();",
        "const fakeStorage = createFakeExperimentStorage();",
        "setNetworkEnabled(true);",
        "// @ts-expect-error The installed root API rejects a numeric API key.",
        "createAmplitudeClient({ analyticsApiKey: 123 });",
        "// @ts-expect-error The installed Experiment subpath rejects a numeric key.",
        "ExperimentSubpath.initialize(123);",
        "// @ts-expect-error The installed network subpath requires a boolean.",
        'setNetworkEnabled("enabled");',
        'const initializedAnalytics: typeof import("' +
          `${packageName}/analytics` +
          '").init = analyticsInit;',
        "void client;",
        "void combined;",
        "void rootExperiment;",
        "void subpathExperiment;",
        "void config;",
        "void freshness;",
        "void timingBuffer;",
        "void fakeStorage;",
        "void initializedAnalytics;",
        "",
      ].join("\n"),
    );

    await Bun.write(
      join(temporaryRoot, "tsconfig.consumer.json"),
      JSON.stringify(
        {
          compilerOptions: {
            ...compilerOptions,
            paths: reactTypePaths,
          },
          files: ["consumer.ts"],
        },
        null,
        2,
      ),
    );

    const consumerTypecheck = run(
      ["bun", "x", "tsc", "--noEmit", "-p", "tsconfig.consumer.json"],
      temporaryRoot,
    );
    if (consumerTypecheck.exitCode !== 0) {
      throw new Error(
        `RN 0.87 installed tarball consumer TypeScript check failed:\n${consumerTypecheck.output}`,
      );
    }

    console.log(
      `${packageName} installed tarball passes the RN 0.87 consumer check for root, analytics, experiment, network, and testing (${declarationEntries.map(({ path }) => path).join(", ")}).`,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

await main();
