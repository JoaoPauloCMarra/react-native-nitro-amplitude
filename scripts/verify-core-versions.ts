const projectRoot = import.meta.dir + "/..";

const expectedVersions = {
  expo: "~57.0.9",
  nitrogen: "0.36.4",
  react: "19.2.3",
  "react-dom": "19.2.3",
  "react-native-gesture-handler": "~2.32.0",
  "react-native": "0.86.2",
  "react-native-nitro-modules": "0.36.4",
  "react-native-nitro-modules-peer": ">=0.36.4 <0.37.0",
  "react-native-reanimated": "4.5.1",
  "react-native-worklets": "0.10.1",
} as const;

type JsonRecord = Record<string, unknown>;

const checks: Array<{
  file: string;
  fields: Array<[string, string, keyof typeof expectedVersions]>;
}> = [
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
    ],
  },
  {
    file: "apps/example/package.json",
    fields: [
      ["dependencies", "expo", "expo"],
      ["dependencies", "react", "react"],
      ["dependencies", "react-dom", "react-dom"],
      [
        "dependencies",
        "react-native-gesture-handler",
        "react-native-gesture-handler",
      ],
      ["dependencies", "react-native", "react-native"],
      [
        "dependencies",
        "react-native-nitro-modules",
        "react-native-nitro-modules",
      ],
      ["dependencies", "react-native-reanimated", "react-native-reanimated"],
      ["dependencies", "react-native-worklets", "react-native-worklets"],
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

if (failures.length > 0) {
  console.error("Core dependency version guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Core dependency versions are pinned as expected.");
