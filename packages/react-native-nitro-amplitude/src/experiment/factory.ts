import { AnalyticsConnector } from "@amplitude/analytics-connector";
import type { IdentityListener } from "@amplitude/analytics-connector";

import { ExperimentClient } from "./experimentClient";
import {
  ConnectorExposureTrackingProvider,
  ConnectorUserProvider,
} from "./integration/connector";
import { Defaults, ExperimentConfig } from "./types/config";

const instances: Record<string, ExperimentClient> = {};

/**
 * Initializes a singleton {@link ExperimentClient} identified by the configured
 * instance name.
 *
 * @param apiKey The deployment API Key
 * @param config See {@link ExperimentConfig} for config options
 */
const initialize = (
  apiKey: string,
  config?: ExperimentConfig,
): ExperimentClient => {
  // Store instances by appending the instance name and api key. Allows for
  // initializing multiple default instances for different api keys.
  const instanceName =
    config?.instanceName ?? Defaults.instanceName ?? "$default_instance";
  const instanceKey = `${instanceName}.${apiKey}`;
  if (!instances[instanceKey]) {
    instances[instanceKey] = new ExperimentClient(apiKey, config || {});
  }
  return instances[instanceKey];
};

/**
 * Initialize a singleton {@link ExperimentClient} which automatically
 * integrates with the installed and initialized instance of the amplitude
 * analytics SDK.
 *
 * You must be using amplitude-js SDK version 8.17.0+ for this integration to
 * work.
 *
 * @param apiKey The deployment API Key
 * @param config See {@link ExperimentConfig} for config options
 */
const initializeWithAmplitudeAnalytics = (
  apiKey: string,
  config?: ExperimentConfig,
): ExperimentClient => {
  // Store instances by appending the instance name and api key. Allows for
  // initializing multiple default instances for different api keys.
  const instanceName =
    config?.instanceName ?? Defaults.instanceName ?? "$default_instance";
  const instanceKey = `${instanceName}.${apiKey}`;
  const connector = AnalyticsConnector.getInstance(instanceName);
  if (!instances[instanceKey]) {
    config = {
      userProvider: new ConnectorUserProvider(connector.identityStore),
      exposureTrackingProvider: new ConnectorExposureTrackingProvider(
        connector.eventBridge,
      ),
      ...config,
    };
    instances[instanceKey] = new ExperimentClient(apiKey, config);
    if (config.automaticFetchOnAmplitudeIdentityChange) {
      const client = instances[instanceKey];
      const listener: IdentityListener = () => {
        client.fetchOnIdentityChange();
      };
      connector.identityStore.addIdentityListener(listener);
      client.addStopCallback(() => {
        connector.identityStore.removeIdentityListener(listener);
      });
    }
  }
  return instances[instanceKey];
};

/**
 * Provides factory methods for storing singleton instances of {@link ExperimentClient}
 * @category Core Usage
 */
export const Experiment = {
  initialize,
  initializeWithAmplitudeAnalytics,
};
