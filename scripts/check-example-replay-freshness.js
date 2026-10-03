const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const manifestRelativePath = "e2e/amplitude-replay-coverage.json";
const lockRelativePath = "e2e/amplitude-replay-source-lock.json";
const runtimeExtensions = new Set([
  ".c",
  ".cc",
  ".gradle",
  ".plist",
  ".properties",
  ".cpp",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".json",
  ".kt",
  ".m",
  ".mm",
  ".podspec",
  ".pro",
  ".swift",
  ".ts",
  ".tsx",
  ".xml",
]);
const assetExtensions = new Set([
  ".gif",
  ".jpg",
  ".jpeg",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
]);
const excludedDirectoryNames = new Set([
  ".cache",
  ".cxx",
  ".expo",
  ".git",
  ".turbo",
  "cache",
  "coverage",
  "__tests__",
  ".gradle",
  "build",
  "dist",
  "lib",
  "node_modules",
  "Pods",
  "test",
  "tests",
  "type-tests",
]);
const runtimeDirectoryRules = [
  { path: "packages/react-native-nitro-amplitude/src", kind: "source" },
  {
    path: "packages/react-native-nitro-amplitude/android/src/main",
    kind: "source",
  },
  { path: "packages/react-native-nitro-amplitude/ios", kind: "source" },
  { path: "packages/react-native-nitro-amplitude/cpp", kind: "source" },
  {
    path: "packages/react-native-nitro-amplitude/nitrogen/generated",
    kind: "source",
  },
  { path: "apps/example", kind: "example" },
];
const runtimeFileRules = [
  "package.json",
  "bun.lock",
  "packages/react-native-nitro-amplitude/android/CMakeLists.txt",
  "packages/react-native-nitro-amplitude/android/build.gradle",
  "packages/react-native-nitro-amplitude/android/gradle.properties",
  "packages/react-native-nitro-amplitude/app.plugin.js",
  "packages/react-native-nitro-amplitude/nitro.json",
  "packages/react-native-nitro-amplitude/package.json",
  "packages/react-native-nitro-amplitude/react-native-nitro-amplitude.podspec",
  "apps/example/app.config.js",
  "apps/example/babel.config.js",
  "apps/example/metro.config.js",
  "apps/example/package.json",
  "apps/example/tsconfig.json",
];

function inside(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Replay coverage path escapes the repository: ${relativePath}`,
    );
  }
  if (fs.existsSync(absolute)) {
    const resolved = path.relative(
      fs.realpathSync(root),
      fs.realpathSync(absolute),
    );
    if (
      resolved === ".." ||
      resolved.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolved)
    ) {
      throw new Error(
        `Replay coverage path escapes the repository through a symlink: ${relativePath}`,
      );
    }
  }
  return absolute;
}

function isSecretPath(relativePath) {
  const basename = path.posix.basename(relativePath);
  return (
    /^\.env(?:\.|$)/i.test(basename) ||
    /\.(?:key|pem|p12|pfx|mobileprovision|provisionprofile)$/i.test(basename)
  );
}

function collectDirectoryFiles(root, relativeDirectory, kind) {
  const absoluteDirectory = inside(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  const files = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          kind === "example" &&
          directory === absoluteDirectory &&
          ["android", "ios"].includes(entry.name)
        )
          continue;
        if (!excludedDirectoryNames.has(entry.name)) visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (isSecretPath(relative)) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (
        kind === "asset" ||
        (kind === "example" && assetExtensions.has(extension))
      ) {
        if (assetExtensions.has(extension)) files.push(relative);
        continue;
      }
      if (!runtimeExtensions.has(extension)) continue;
      if (/\.(?:spec|test)\.[^.]+$/i.test(entry.name)) continue;
      if (
        /(?:Test|Tests)\.(?:c|cc|cpp|h|hpp|m|mm|kt|java|swift)$/.test(
          entry.name,
        )
      )
        continue;
      files.push(relative);
    }
  };
  visit(absoluteDirectory);
  return files;
}

function withoutGitIgnored(root, files) {
  if (files.length === 0) return files;
  const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: root,
    input: files.join("\0"),
  });
  if (result.status !== 0) return files;
  const ignored = new Set(result.stdout.toString("utf8").split("\0"));
  return files.filter((file) => !ignored.has(file));
}

function collectRuntimeFiles(root) {
  const files = new Set();
  for (const rule of runtimeDirectoryRules) {
    for (const file of collectDirectoryFiles(root, rule.path, rule.kind)) {
      files.add(file);
    }
  }
  for (const relativePath of runtimeFileRules) {
    const filePath = inside(root, relativePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      files.add(relativePath);
    }
  }
  return withoutGitIgnored(root, [...files].sort());
}

function hashFiles(root, relativePaths) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of relativePaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(inside(root, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readCoverageManifest(root, manifestPath = manifestRelativePath) {
  const manifestFile = inside(root, manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.suites)) {
    throw new Error(
      "Replay coverage manifest must use version 1 and list suites",
    );
  }
  if (
    !Array.isArray(manifest.features) ||
    !Array.isArray(manifest.pending) ||
    manifest.features.length === 0
  ) {
    throw new Error(
      "Replay coverage manifest must list replay features and pending prerequisites",
    );
  }

  const suitePaths = manifest.suites.map((suite) => suite.path);
  if (
    suitePaths.length === 0 ||
    new Set(suitePaths).size !== suitePaths.length ||
    suitePaths.some(
      (suitePath) =>
        typeof suitePath !== "string" ||
        !suitePath.startsWith("e2e/") ||
        suitePath.includes("..") ||
        !suitePath.endsWith(".ad"),
    )
  ) {
    throw new Error(
      "Replay coverage manifest contains an empty, duplicate, or unsafe suite path",
    );
  }
  const suiteFiles = new Map(
    suitePaths.map((suitePath) => [
      suitePath,
      (() => {
        const file = inside(root, suitePath);
        if (!fs.existsSync(file) || !fs.lstatSync(file).isFile())
          throw new Error(`Replay flow is missing: ${suitePath}`);
        return fs.readFileSync(file, "utf8");
      })(),
    ]),
  );
  const fixtureMarker = manifest.fixtureMarker;
  if (
    !fixtureMarker ||
    typeof fixtureMarker.source !== "string" ||
    !fixtureMarker.source.startsWith("apps/example/") ||
    typeof fixtureMarker.guardFragment !== "string" ||
    typeof fixtureMarker.text !== "string" ||
    !Array.isArray(fixtureMarker.suites)
  ) {
    throw new Error(
      "Replay coverage manifest must pin the visible fixture-mode guard",
    );
  }
  const fixtureSource = fs.readFileSync(
    inside(root, fixtureMarker.source),
    "utf8",
  );
  if (
    !fixtureSource.includes(fixtureMarker.guardFragment) ||
    !fixtureSource.includes(fixtureMarker.text)
  ) {
    throw new Error(
      "Example fixture-mode marker is missing from the app source",
    );
  }
  for (const suitePath of fixtureMarker.suites) {
    const suite = suiteFiles.get(suitePath);
    if (!suite || !suite.includes(`wait text "${fixtureMarker.text}"`)) {
      throw new Error(
        `${suitePath} does not assert the visible fixture-mode marker`,
      );
    }
  }
  const featureIds = new Set();
  for (const feature of manifest.features) {
    if (
      typeof feature.id !== "string" ||
      !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(feature.id) ||
      featureIds.has(feature.id)
    ) {
      throw new Error(
        `Replay feature has a missing or duplicate semantic id: ${feature.id}`,
      );
    }
    featureIds.add(feature.id);
    const suite = suiteFiles.get(feature.suite);
    if (!suite)
      throw new Error(`${feature.id} names a suite outside the manifest`);
    const sourcePath = inside(root, feature.source);
    if (!feature.source.startsWith("apps/example/")) {
      throw new Error(`${feature.id} must point at an example source file`);
    }
    const source = fs.readFileSync(sourcePath, "utf8");
    if (feature.trigger !== undefined && feature.trigger !== "load") {
      throw new Error(`${feature.id} has an unsupported trigger`);
    }
    const loadTriggered = feature.trigger === "load";
    if (loadTriggered && Object.hasOwn(feature, "controlId")) {
      throw new Error(`${feature.id} is load-triggered and has a controlId`);
    }
    for (const [name, value] of [
      ...(loadTriggered ? [] : [["controlId", feature.controlId]]),
      ["statusId", feature.statusId],
      ["expectedText", feature.expectedText],
      ["statusFragment", feature.statusFragment],
    ]) {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${feature.id} has no ${name}`);
      }
    }
    if (!feature.transport || feature.coverage !== "replay-asserted") {
      throw new Error(
        `${feature.id} must state its transport and replay coverage`,
      );
    }
    if (!loadTriggered && !source.includes(`testID="${feature.controlId}"`)) {
      throw new Error(
        `${feature.id} control is missing from ${feature.source}`,
      );
    }
    if (!source.includes(`testID="${feature.statusId}"`)) {
      throw new Error(
        `${feature.id} status selector is missing from ${feature.source}`,
      );
    }
    if (!source.includes(feature.statusFragment)) {
      throw new Error(
        `${feature.id} status assertion is missing from ${feature.source}`,
      );
    }
    if (loadTriggered) {
      if (!suite.includes(`wait id="${feature.statusId}"`)) {
        throw new Error(
          `${feature.id} has no load status wait in ${feature.suite}`,
        );
      }
    } else if (!suite.includes(`press id="${feature.controlId}"`)) {
      throw new Error(`${feature.id} is not pressed by ${feature.suite}`);
    }
    if (!suite.includes(`wait text "${feature.expectedText}"`)) {
      throw new Error(
        `${feature.id} has no matching replay assertion in ${feature.suite}`,
      );
    }
  }
  for (const pending of manifest.pending) {
    if (
      typeof pending.id !== "string" ||
      !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pending.id) ||
      featureIds.has(pending.id)
    ) {
      throw new Error(
        `Pending row has a missing or duplicate semantic id: ${pending.id}`,
      );
    }
    featureIds.add(pending.id);
    if (
      pending.state !== "pending-prerequisites" ||
      typeof pending.reason !== "string" ||
      !Array.isArray(pending.prerequisites) ||
      pending.prerequisites.length === 0 ||
      Object.hasOwn(pending, "expectedText")
    ) {
      throw new Error(
        `${pending.id} must remain pending until its prerequisites are met`,
      );
    }
  }
  return { manifest, manifestFile, suiteFiles, suitePaths };
}

function createExpectedLock(root, options = {}) {
  const manifestPath = options.manifestPath ?? manifestRelativePath;
  const { manifest, manifestFile, suitePaths } = readCoverageManifest(
    root,
    manifestPath,
  );
  const runtimeFiles = collectRuntimeFiles(root);
  const suitesSha256 = hashFiles(root, suitePaths);
  return {
    version: 1,
    runtimeSourceSha256: hashFiles(root, runtimeFiles),
    runtimeSourceFiles: runtimeFiles,
    coverageManifestSha256: hashFiles(root, [manifestPath]),
    suiteFilesSha256: suitesSha256,
    suites: manifest.suites.map((suite) => suite.path),
    _manifestFile: manifestFile,
  };
}

function withoutInternalFields(lock) {
  const { _manifestFile, ...publicLock } = lock;
  return publicLock;
}

function checkReplayFreshness({
  root = process.cwd(),
  manifestPath = manifestRelativePath,
  lockPath = lockRelativePath,
} = {}) {
  const expected = withoutInternalFields(
    createExpectedLock(root, { manifestPath }),
  );
  const absoluteLockPath = inside(root, lockPath);
  if (!fs.existsSync(absoluteLockPath)) {
    return { fresh: false, expected, reason: "source lock is missing" };
  }
  const actual = JSON.parse(fs.readFileSync(absoluteLockPath, "utf8"));
  const fresh = JSON.stringify(actual) === JSON.stringify(expected);
  return {
    fresh,
    expected,
    actual,
    reason: fresh
      ? undefined
      : "runtime source, replay suite, or coverage changed",
  };
}

function refreshReplayLock({
  root = process.cwd(),
  manifestPath = manifestRelativePath,
  lockPath = lockRelativePath,
} = {}) {
  const expected = withoutInternalFields(
    createExpectedLock(root, { manifestPath }),
  );
  fs.writeFileSync(
    inside(root, lockPath),
    `${JSON.stringify(expected, null, 2)}\n`,
  );
  return expected;
}

function main(argv) {
  if (
    argv.length > 1 ||
    (argv[0] && argv[0] !== "--check" && argv[0] !== "--refresh")
  ) {
    throw new Error(
      "Usage: bun scripts/check-example-replay-freshness.js [--check|--refresh]",
    );
  }
  const refreshing = argv[0] === "--refresh";
  if (refreshing) {
    const lock = refreshReplayLock();
    process.stdout.write(
      `Replay source lock refreshed for ${lock.runtimeSourceFiles.length} runtime files and ${lock.suites.length} suites.\n`,
    );
    return 0;
  }
  const result = checkReplayFreshness();
  if (!result.fresh) {
    process.stderr.write(
      `Replay source lock is stale: ${result.reason}. Review the affected replay and coverage rows, then run bun scripts/check-example-replay-freshness.js --refresh.\n`,
    );
    return 1;
  }
  process.stdout.write(
    `Replay source lock is current for ${result.expected.runtimeSourceFiles.length} runtime files and ${result.expected.suites.length} suites.\n`,
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = {
  checkReplayFreshness,
  collectRuntimeFiles,
  inside,
  refreshReplayLock,
};
