const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(packageRoot, relativePath), "utf8");
}

function jniStaticMethodNames() {
  const source = read("android/src/main/cpp/AndroidAmplitudeAdapterCpp.cpp");
  const pattern = /getStaticMethod<[\s\S]*?>\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function adapterKeepBlock() {
  const rules = read("android/consumer-rules.pro");
  const match = rules.match(
    /-keep class com\.nitroamplitude\.AndroidAmplitudeAdapter \{([^}]*)\}/,
  );
  return match ? match[1] : "";
}

describe("Android initializer", () => {
  it("registers the package initializer provider in the Android manifest", () => {
    const manifest = read("android/src/main/AndroidManifest.xml");

    expect(manifest).toContain("com.nitroamplitude.NitroAmplitudeInitializer");
    expect(manifest).toContain("${applicationId}.nitroamplitude-initializer");
  });
});

describe("Android JNI contract", () => {
  const names = jniStaticMethodNames();

  it("finds every static method that C++ resolves by name", () => {
    expect(names).toEqual(
      expect.arrayContaining([
        "getStorageDirectory",
        "getLegacyDiskEntries",
        "clearLegacyDisk",
        "prefetchContext",
        "getApplicationContextJson",
        "performHttpRequest",
      ]),
    );
  });

  it("keeps every JNI-resolved method through R8", () => {
    const block = adapterKeepBlock();
    const keepsAllStatics = /public\s+static\s+<methods>\s*;/.test(block);
    for (const name of names) {
      const keptByName = new RegExp(`\\b${name}\\s*\\(`).test(block);
      expect({ name, kept: keepsAllStatics || keptByName }).toEqual({
        name,
        kept: true,
      });
    }
  });

  it("declares every JNI-resolved method as a Kotlin static", () => {
    const adapter = read(
      "android/src/main/java/com/nitroamplitude/AndroidAmplitudeAdapter.kt",
    );
    for (const name of names) {
      expect({
        name,
        isStatic: new RegExp(`@JvmStatic\\s+fun\\s+${name}\\s*\\(`).test(adapter),
      }).toEqual({ name, isStatic: true });
    }
  });
});
