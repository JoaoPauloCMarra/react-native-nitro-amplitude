"use strict";

function findSupportedLineFailures(version, securityText) {
  const match = /^(\d+)\.(\d+)\.\d+/u.exec(version);
  if (!match) {
    throw new Error(`Package version ${version} is not a SemVer version.`);
  }
  const line = `${match[1]}.${match[2]}.x`;
  const failures = [];
  const hasRow = new RegExp(
    `^\\|\\s*${line.replaceAll(".", "\\.")}\\s*\\|\\s*Yes\\s*\\|`,
    "mu",
  ).test(securityText);
  if (!hasRow) {
    failures.push(`SECURITY.md supported-versions table does not list ${line} as supported`);
  }
  if (!securityText.includes(`The latest \`${line}\` release`)) {
    failures.push(`SECURITY.md does not name \`${line}\` as the supported line`);
  }
  return failures;
}

module.exports = { findSupportedLineFailures };
