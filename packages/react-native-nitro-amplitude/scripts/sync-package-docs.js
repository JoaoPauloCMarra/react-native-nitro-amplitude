const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const backupRoot = path.join(packageRoot, ".pack-docs-backup");

const entries = [
  { source: "README.md", target: "README.md", type: "file" },
  { source: "LICENSE", target: "LICENSE", type: "file" },
  { source: "SECURITY.md", target: "SECURITY.md", type: "file" },
  { source: "docs", target: "docs", type: "directory" },
];

function removeTarget(target) {
  const targetPath = path.join(packageRoot, target);
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

function backupTarget(target) {
  const targetPath = path.join(packageRoot, target);
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const backupPath = path.join(backupRoot, target);
  fs.rmSync(backupPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.cpSync(targetPath, backupPath, { recursive: true });
}

function restoreTarget(entry) {
  const backupPath = path.join(backupRoot, entry.target);
  if (!fs.existsSync(backupPath)) {
    const sourcePath = path.join(repoRoot, entry.source);
    if (entry.type === "file" && fs.existsSync(sourcePath)) {
      removeTarget(entry.target);
      fs.mkdirSync(path.dirname(path.join(packageRoot, entry.target)), {
        recursive: true,
      });
      fs.copyFileSync(sourcePath, path.join(packageRoot, entry.target));
      return;
    }
    removeTarget(entry.target);
    return;
  }

  removeTarget(entry.target);
  fs.mkdirSync(path.dirname(path.join(packageRoot, entry.target)), {
    recursive: true,
  });
  fs.cpSync(backupPath, path.join(packageRoot, entry.target), {
    recursive: true,
  });
}

function copyEntry(entry) {
  const sourcePath = path.join(repoRoot, entry.source);
  const targetPath = path.join(packageRoot, entry.target);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Required package artifact source is missing: ${entry.source}`,
    );
  }

  backupTarget(entry.target);
  removeTarget(entry.target);

  if (entry.type === "directory") {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
}

function prepare() {
  fs.rmSync(backupRoot, { recursive: true, force: true });
  entries.forEach(copyEntry);
}

function cleanup() {
  entries.forEach(restoreTarget);
  fs.rmSync(backupRoot, { recursive: true, force: true });
}

const mode = process.argv[2];

try {
  if (mode === "prepare") {
    prepare();
  } else if (mode === "cleanup") {
    cleanup();
  } else {
    throw new Error(
      "Usage: node scripts/sync-package-docs.js <prepare|cleanup>",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
