const projectRoot = import.meta.dir + "/..";

const expectedVersions = {
  expo: "~57.0.15",
  "expo-asset": "~57.0.13",
  "expo-build-properties": "~57.0.13",
  "expo-constants": "~57.0.13",
  "expo-linking": "~57.0.7",
  "expo-router": "~57.0.15",
  "expo-splash-screen": "~57.0.7",
  nitrogen: "0.37.0",
  react: "19.2.3",
  "react-dom": "19.2.3",
  "react-native-gesture-handler": "~2.32.0",
  "react-native": "0.86.2",
  "react-native-example": "0.86.2",
  "react-native-nitro-modules": "0.37.0",
  "react-native-nitro-modules-peer": ">=0.37.0 <0.38.0",
  "react-native-reanimated": "4.5.1",
  "react-native-worklets": "0.10.1",
  "babel-preset-expo": "~57.0.6",
  "@amplitude/analytics-core": "2.54.2",
  "@amplitude/analytics-connector": "^1.6.7",
  "@amplitude/experiment-core": "^0.13.5",
  "@amplitude/ua-parser-js": "^0.7.33",
} as const;

type JsonRecord = Record<string, unknown>;

const checks: {
  file: string;
  fields: [string, string, keyof typeof expectedVersions][];
}[] = [
  {
    file: "package.json",
    fields: [
      ["devDependencies", "nitrogen", "nitrogen"],
      [
        "devDependencies",
        "react-native-nitro-modules",
        "react-native-nitro-modules",
      ],
      ["overrides", "expo", "expo"],
      ["overrides", "react", "react"],
      ["overrides", "react-dom", "react-dom"],
      ["overrides", "react-native", "react-native"],
      ["overrides", "react-native-nitro-modules", "react-native-nitro-modules"],
      ["devDependencies", "react-native", "react-native"],
    ],
  },
  {
    file: "apps/example/package.json",
    fields: [
      ["dependencies", "expo", "expo"],
      ["dependencies", "expo-asset", "expo-asset"],
      ["dependencies", "expo-build-properties", "expo-build-properties"],
      ["dependencies", "expo-constants", "expo-constants"],
      ["dependencies", "expo-linking", "expo-linking"],
      ["dependencies", "expo-router", "expo-router"],
      ["dependencies", "expo-splash-screen", "expo-splash-screen"],
      ["dependencies", "react", "react"],
      ["dependencies", "react-dom", "react-dom"],
      [
        "dependencies",
        "react-native-gesture-handler",
        "react-native-gesture-handler",
      ],
      ["dependencies", "react-native", "react-native-example"],
      [
        "dependencies",
        "react-native-nitro-modules",
        "react-native-nitro-modules",
      ],
      ["dependencies", "react-native-reanimated", "react-native-reanimated"],
      ["dependencies", "react-native-worklets", "react-native-worklets"],
      ["devDependencies", "babel-preset-expo", "babel-preset-expo"],
    ],
  },
  {
    file: "packages/react-native-nitro-amplitude/package.json",
    fields: [
      [
        "peerDependencies",
        "react-native-nitro-modules",
        "react-native-nitro-modules-peer",
      ],
      [
        "dependencies",
        "@amplitude/analytics-core",
        "@amplitude/analytics-core",
      ],
      [
        "dependencies",
        "@amplitude/analytics-connector",
        "@amplitude/analytics-connector",
      ],
      [
        "dependencies",
        "@amplitude/experiment-core",
        "@amplitude/experiment-core",
      ],
      ["dependencies", "@amplitude/ua-parser-js", "@amplitude/ua-parser-js"],
    ],
  },
];

const readJson = async (relativePath: string): Promise<JsonRecord> => {
  const source = await Bun.file(`${projectRoot}/${relativePath}`).text();
  return JSON.parse(source) as JsonRecord;
};

const getPathValue = (obj: JsonRecord, segments: string[]): unknown =>
  segments.reduce<unknown>(
    (value, segment) =>
      value != null && typeof value === "object"
        ? (value as JsonRecord)[segment]
        : undefined,
    obj,
  );

const failures: string[] = [];

for (const check of checks) {
  const json = await readJson(check.file);

  for (const [section, depName, expectedName] of check.fields) {
    const actualValue = getPathValue(json, [section, depName]);
    const expectedValue = expectedVersions[expectedName];

    if (actualValue !== expectedValue) {
      failures.push(
        `${projectRoot}/${check.file} -> ${section}.${depName}: expected "${expectedValue}", got "${String(actualValue)}"`,
      );
    }
  }
}

const rootManifest = await readJson("package.json");
if (
  getPathValue(rootManifest, ["scripts", "typecheck:rn087"]) !==
  "bun scripts/verify-rn087-types.ts"
) {
  failures.push(
    "package.json -> scripts.typecheck:rn087 must run the RN 0.87 Strict TypeScript check",
  );
}

if (failures.length > 0) {
  console.error("Core dependency version guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Core dependency versions are pinned as expected.");
