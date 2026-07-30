const fs = require("fs");
const path = require("path");

describe("Android initializer", () => {
  const packageRoot = path.resolve(__dirname, "../..");

  it("registers the package initializer provider in the Android manifest", () => {
    const manifest = fs.readFileSync(
      path.join(packageRoot, "android/src/main/AndroidManifest.xml"),
      "utf8",
    );

    expect(manifest).toContain("com.nitroamplitude.NitroAmplitudeInitializer");
    expect(manifest).toContain("${applicationId}.nitroamplitude-initializer");
  });

  it("initializes the Android adapter from application context", () => {
    const initializer = fs.readFileSync(
      path.join(
        packageRoot,
        "android/src/main/java/com/nitroamplitude/NitroAmplitudeInitializer.kt",
      ),
      "utf8",
    );

    expect(initializer).toContain(
      "context?.applicationContext?.let(AndroidAmplitudeAdapter::setContext)",
    );
  });

  it("omits unavailable Android context fields", () => {
    const adapter = fs.readFileSync(
      path.join(
        packageRoot,
        "android/src/main/java/com/nitroamplitude/AndroidAmplitudeAdapter.kt",
      ),
      "utf8",
    );

    for (const field of ["carrier", "idfv", "adid", "appSetId"]) {
      expect(adapter).not.toContain(`json.put("${field}", "")`);
    }
  });
});
