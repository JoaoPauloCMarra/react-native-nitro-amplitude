const { withMainApplication, createRunOncePlugin } = require("@expo/config-plugins");

const withNitroAmplitude = (config) => {
  return withMainApplication(config, (config) => {
    const { modResults } = config;
    const { language, contents } = modResults;

    if (language === "kt") {
      if (!contents.includes("AndroidAmplitudeAdapter.setContext")) {
        const importStatement =
          "import com.nitroamplitude.AndroidAmplitudeAdapter";
        const initStatement = "    AndroidAmplitudeAdapter.setContext(this)";

        if (!contents.includes(importStatement)) {
          modResults.contents = contents.replace(
            /(package .*\n)/,
            `$1\n${importStatement}\n`,
          );
        }

        modResults.contents = modResults.contents.replace(
          /(super\.onCreate\(\))/,
          `$1\n${initStatement}`,
        );
      }
    }

    return config;
  });
};

module.exports = createRunOncePlugin(
  withNitroAmplitude,
  "react-native-nitro-amplitude",
  "1.0.0",
);
