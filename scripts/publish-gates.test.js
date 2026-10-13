const { describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const publishSource = fs.readFileSync(
  path.join(root, "scripts", "publish.js"),
  "utf8",
);
const rootPackage = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

describe("publish gate", () => {
  test("keeps one quality gate that release:preflight can skip", () => {
    expect(publishSource.match(/`bun run check`/g)).toHaveLength(1);
    expect(publishSource).toContain('args.includes("--skip-quality")');
    expect(rootPackage.scripts["release:preflight"]).toContain(
      "publish-package:dry-run -- --skip-quality",
    );
  });

  test("artifact stage does not repeat the quality gate", () => {
    const artifactStage = publishSource.slice(
      publishSource.indexOf("Preparing package artifacts"),
    );
    expect(artifactStage).not.toContain("bun run test:cpp");
    expect(artifactStage).not.toContain("bun run test:types");
  });
});

describe("package doc lifecycle", () => {
  test("copies only documents the package tarball ships", () => {
    const syncSource = fs.readFileSync(
      path.join(
        root,
        "packages",
        "react-native-nitro-amplitude",
        "scripts",
        "sync-package-docs.js",
      ),
      "utf8",
    );
    const packageJson = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "packages",
          "react-native-nitro-amplitude",
          "package.json",
        ),
        "utf8",
      ),
    );
    const alwaysPacked = new Set(["README.md", "LICENSE"]);
    const sources = [...syncSource.matchAll(/source: "([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(alwaysPacked.has(source) || packageJson.files.includes(source)).toBe(
        true,
      );
    }
  });
});

describe("publish workflow", () => {
  test("every validate output is read by a later job", () => {
    const workflow = fs.readFileSync(
      path.join(root, ".github", "workflows", "npm-publish.yml"),
      "utf8",
    );
    const block = workflow.match(/^ {4}outputs:\n((?: {6}\S.*\n)+)/m)?.[1] ?? "";
    const outputs = [...block.matchAll(/^ {6}(\w+):/gm)].map((m) => m[1]);
    expect(outputs.length).toBeGreaterThan(0);
    for (const output of outputs) {
      expect(workflow).toContain(`needs.validate.outputs.${output}`);
    }
  });
});
