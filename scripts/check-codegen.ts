const projectRoot = import.meta.dir + "/..";
const generatedRoot =
  projectRoot + "/packages/react-native-nitro-amplitude/nitrogen/generated";

async function snapshotGeneratedFiles(): Promise<Map<string, bigint>> {
  const snapshot = new Map<string, bigint>();
  const files = new Bun.Glob("**/*").scan({
    cwd: generatedRoot,
    dot: true,
    onlyFiles: true,
  });

  for await (const relativePath of files) {
    const contents = await Bun.file(`${generatedRoot}/${relativePath}`).bytes();
    snapshot.set(relativePath, Bun.hash(contents));
  }

  return snapshot;
}

const before = await snapshotGeneratedFiles();
const codegen = Bun.spawn(["bun", "run", "codegen"], {
  cwd: projectRoot,
  stdout: "inherit",
  stderr: "inherit",
});

if ((await codegen.exited) !== 0) {
  process.exit(1);
}

const after = await snapshotGeneratedFiles();
const paths = new Set([...before.keys(), ...after.keys()]);
const changedPaths = [...paths]
  .filter((path) => before.get(path) !== after.get(path))
  .sort();

if (changedPaths.length > 0) {
  console.error("Generated Nitro bindings are stale:");
  for (const path of changedPaths) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log("Generated Nitro bindings are current.");
