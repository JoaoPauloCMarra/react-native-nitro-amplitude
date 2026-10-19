const { describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

describe("publish --skip-quality", () => {
  test("is rejected outside a dry run", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts", "publish.js"), "--skip-quality", "--yes"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("--skip-quality is only allowed");
  });
});

describe("publish dist-tag validation", () => {
  const rejected = ["1beta", "v1.2", "v1", "2024", "a".repeat(70)];

  for (const tag of rejected) {
    test(`rejects dist-tags the workflow rejects: ${tag.slice(0, 12)}`, () => {
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, "scripts", "publish.js"),
          "--dry-run",
          "--yes",
          `--tag=${tag}`,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain("DIST_TAG");
    });
  }
});
