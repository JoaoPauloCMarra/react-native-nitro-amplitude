export default ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    amplitudeApiKey: process.env.AMPLITUDE_API_KEY ?? "",
    amplitudeExperimentKey:
      process.env.AMPLITUDE_EXPERIMENT_KEY ?? process.env.AMPLITUDE_API_KEY ?? "",
  },
});
