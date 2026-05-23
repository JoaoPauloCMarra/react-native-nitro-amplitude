import type {
  Event,
  ReactNativeOptions,
  UserSession,
} from "@amplitude/analytics-core";
import { getAnalyticsConnector } from "@amplitude/analytics-core";
import { createInstance } from "./analytics/react-native-client";
import type { AmplitudeReactNativeClient } from "./analytics/react-native-client";
import { NetworkGuardedFetchTransport } from "./analytics/network-guarded-fetch-transport";
import { isNative } from "./analytics/utils/platform";
import { Experiment } from "./experiment/factory";
import type { ExperimentClient } from "./experiment/experimentClient";
import type { ExperimentConfig } from "./experiment/types/config";
import type { ExperimentUser } from "./experiment/types/user";
import { dryRunHttpClient, dryRunTransport } from "./network";

function getStorageModule(): typeof import("./native/storage") {
  if (isNative()) {
    return require("./native/storage") as typeof import("./native/storage");
  }
  return require("./native/storage.web") as typeof import("./native/storage");
}

function getAnalyticsTransport() {
  if (isNative()) {
    const { nitroTransport } =
      require("./analytics/nitro-transport") as typeof import("./analytics/nitro-transport");
    return nitroTransport;
  }
  return new NetworkGuardedFetchTransport();
}

export type DurableAmplitudeStoragePreset = {
  analytics: Pick<
    ReactNativeOptions,
    "storageProvider" | "cookieStorage" | "transportProvider"
  >;
  experiment: Pick<ExperimentConfig, "storage">;
  clear: () => Promise<void>;
};

export type DurableAmplitudeStoragePresetOptions = {
  namespace?: string;
  dryRun?: boolean;
};

export type AmplitudeCombinedClientConfig = {
  analyticsApiKey: string;
  experimentDeploymentKey?: string;
  userId?: string;
  instanceName?: string;
  analytics?: ReactNativeOptions;
  experiment?: ExperimentConfig;
  durableStorage?: boolean | DurableAmplitudeStoragePresetOptions;
  dryRun?: boolean;
};

export type AmplitudeCombinedClient = {
  analytics: AmplitudeReactNativeClient;
  experiment?: ExperimentClient;
  init: (user?: ExperimentUser) => Promise<AmplitudeCombinedClient>;
  flush: () => Promise<void>;
  reset: () => void;
  getUserId: () => string | undefined;
  getDeviceId: () => string | undefined;
};

export type AmplitudeCombinedClientConfigWithExperiment =
  AmplitudeCombinedClientConfig & {
    experimentDeploymentKey: string;
  };

export type AmplitudeCombinedClientWithExperiment = Omit<
  AmplitudeCombinedClient,
  "experiment" | "init"
> & {
  experiment: ExperimentClient;
  init: (
    user?: ExperimentUser,
  ) => Promise<AmplitudeCombinedClientWithExperiment>;
};

export function createDurableAmplitudeStoragePreset(
  options: DurableAmplitudeStoragePresetOptions = {},
): DurableAmplitudeStoragePreset {
  const namespace = options.namespace ?? "default";
  const { NitroAnalyticsStorage, NitroExperimentStorage } = getStorageModule();
  const analyticsEvents = new NitroAnalyticsStorage<Event[]>(
    `${namespace}:analytics-events`,
  );
  const analyticsSession = new NitroAnalyticsStorage<UserSession>(
    `${namespace}:analytics-session`,
  );
  const experimentVariants = new NitroExperimentStorage(
    `${namespace}:experiment-variants`,
  );
  return {
    analytics: {
      storageProvider: analyticsEvents,
      cookieStorage: analyticsSession,
      transportProvider: options.dryRun
        ? dryRunTransport
        : getAnalyticsTransport(),
    },
    experiment: {
      storage: experimentVariants,
    },
    clear: async () => {
      await analyticsEvents.reset();
      await analyticsSession.reset();
      await experimentVariants.reset?.();
    },
  };
}

export function createPersistentAmplitudeConfig(
  namespaceOrOptions?: string | DurableAmplitudeStoragePresetOptions,
): DurableAmplitudeStoragePreset {
  if (typeof namespaceOrOptions === "string") {
    return createDurableAmplitudeStoragePreset({
      namespace: namespaceOrOptions,
    });
  }
  return createDurableAmplitudeStoragePreset(namespaceOrOptions);
}

export function createExperimentUser(user: ExperimentUser): ExperimentUser {
  return {
    ...user,
    user_properties: user.user_properties
      ? { ...user.user_properties }
      : undefined,
    groups: user.groups ? { ...user.groups } : undefined,
    group_properties: user.group_properties
      ? { ...user.group_properties }
      : undefined,
  };
}

export function createAmplitudeClient(
  config: AmplitudeCombinedClientConfigWithExperiment,
): AmplitudeCombinedClientWithExperiment;
export function createAmplitudeClient(
  config: AmplitudeCombinedClientConfig,
): AmplitudeCombinedClient;
export function createAmplitudeClient(config: AmplitudeCombinedClientConfig) {
  const instanceName = config.instanceName ?? "$default_instance";
  const dryRunEnabled =
    config.dryRun ||
    (typeof config.durableStorage === "object" && config.durableStorage.dryRun);
  const storagePreset =
    config.durableStorage === false
      ? undefined
      : createDurableAmplitudeStoragePreset({
          namespace:
            typeof config.durableStorage === "object"
              ? config.durableStorage.namespace
              : instanceName,
          dryRun: dryRunEnabled,
        });
  const analytics = createInstance();
  const experiment =
    config.experimentDeploymentKey !== undefined
      ? Experiment.initializeWithAmplitudeAnalytics(
          config.experimentDeploymentKey,
          {
            ...storagePreset?.experiment,
            ...config.experiment,
            instanceName,
            httpClient: dryRunEnabled
              ? (config.experiment?.httpClient ?? dryRunHttpClient)
              : config.experiment?.httpClient,
          },
        )
      : undefined;
  const combined = {
    analytics,
    experiment,
    init: async (user?: ExperimentUser) => {
      await analytics.init(config.analyticsApiKey, config.userId, {
        ...storagePreset?.analytics,
        ...config.analytics,
        instanceName,
        transportProvider: dryRunEnabled
          ? (config.analytics?.transportProvider ?? dryRunTransport)
          : (config.analytics?.transportProvider ??
            storagePreset?.analytics.transportProvider),
      }).promise;
      if (experiment && user) {
        experiment.setUser(user);
      }
      return combined;
    },
    flush: async () => analytics.flush().promise,
    reset: () => analytics.reset(),
    getUserId: () => analytics.getUserId(),
    getDeviceId: () => analytics.getDeviceId(),
  } as AmplitudeCombinedClient;

  return combined;
}

export function getConnectorIdentity(instanceName = "$default_instance"): {
  userId?: string;
  deviceId?: string;
} {
  return getAnalyticsConnector(instanceName).identityStore.getIdentity();
}
