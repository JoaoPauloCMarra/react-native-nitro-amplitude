const { withGradleProperties } = require("expo/config-plugins");

const FAST_PROPERTIES = {
  "org.gradle.caching": "true",
  "org.gradle.parallel": "true",
  "org.gradle.jvmargs":
    "-Xmx6g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8",
  "kotlin.daemon.jvmargs": "-Xmx3g",
};

module.exports = function withFastGradle(config) {
  return withGradleProperties(config, (modConfig) => {
    const items = modConfig.modResults;
    for (const [key, value] of Object.entries(FAST_PROPERTIES)) {
      const existing = items.find(
        (item) => item.type === "property" && item.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        items.push({ type: "property", key, value });
      }
    }
    return modConfig;
  });
};
