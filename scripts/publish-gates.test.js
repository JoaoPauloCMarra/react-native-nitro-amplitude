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
