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
 * Calling `initialize` again with the same instance name and api key returns
 * the existing instance and ignores later configuration changes. Use
 * {@link Experiment.reinitialize} to replace an instance explicitly.
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
  const instanceKey = getInstanceKey(apiKey, config?.instanceName);
  if (!instances[instanceKey]) {
    instances[instanceKey] = new ExperimentClient(apiKey, config || {});
  }
  return instances[instanceKey];
};

/**
 * Replaces an existing singleton {@link ExperimentClient} for the configured
 * instance name and api key. The previous instance is stopped, so any retry
 * and polling work it started is cancelled, and subsequent `initialize` calls
 * return the new instance.
 *
 * @param apiKey The deployment API Key
 * @param config See {@link ExperimentConfig} for config options
 */
const reinitialize = (
  apiKey: string,
  config?: ExperimentConfig,
): ExperimentClient => {
  const instanceKey = getInstanceKey(apiKey, config?.instanceName);
  const existing = instances[instanceKey];
  if (existing) {
    existing.stop();
  }
  const client = new ExperimentClient(apiKey, config || {});
  instances[instanceKey] = client;
  return client;
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
  const instanceKey = getInstanceKey(apiKey, config?.instanceName);
  const connector = AnalyticsConnector.getInstance(
    config?.instanceName ?? Defaults.instanceName ?? "$default_instance",
  );
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

function getInstanceKey(apiKey: string, instanceName?: string): string {
  const resolvedInstanceName =
    instanceName ?? Defaults.instanceName ?? "$default_instance";
  return `${resolvedInstanceName}.${apiKey}`;
}

/**
 * Provides factory methods for storing singleton instances of {@link ExperimentClient}
 * @category Core Usage
 */
export const Experiment = {
  initialize,
  reinitialize,
  initializeWithAmplitudeAnalytics,
};
