const { createRunOncePlugin } = require("@expo/config-plugins");
const pkg = require("./package.json");

const withNitroAmplitude = (config) => config;

module.exports = createRunOncePlugin(
  withNitroAmplitude,
  pkg.name,
  pkg.version,
);
module.exports.withNitroAmplitude = withNitroAmplitude;
