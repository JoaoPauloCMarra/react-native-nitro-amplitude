const { describe, expect, test } = require("bun:test");
const { findSupportedLineFailures } = require("./release-docs");

const policy = (line) => `| Version | Supported |
| ------- | --------- |
| ${line}  | Yes       |

The latest \`${line}\` release is the only supported line.
`;

describe("findSupportedLineFailures", () => {
  test("accepts a policy that names the current minor line", () => {
    expect(findSupportedLineFailures("0.11.1", policy("0.11.x"))).toEqual([]);
    expect(findSupportedLineFailures("0.12.0-rc.1", policy("0.12.x"))).toEqual([]);
  });

  test("rejects a policy that names an older line", () => {
    const failures = findSupportedLineFailures("0.11.1", policy("0.10.x"));
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("0.11.x");
  });

  test("rejects a missing table row or sentence separately", () => {
    expect(
      findSupportedLineFailures("0.11.1", "| 0.11.x | Yes |\n"),
    ).toHaveLength(1);
    expect(
      findSupportedLineFailures("0.11.1", "The latest `0.11.x` release.\n"),
    ).toHaveLength(1);
  });

  test("rejects a version that is not semver", () => {
    expect(() => findSupportedLineFailures("latest", policy("0.11.x"))).toThrow();
  });
});
