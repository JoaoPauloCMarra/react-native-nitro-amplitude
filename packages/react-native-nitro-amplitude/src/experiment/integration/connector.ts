import { EventBridge, IdentityStore } from "@amplitude/analytics-connector";
import { safeGlobal } from "@amplitude/experiment-core";

import { Exposure, ExposureTrackingProvider } from "../types/exposure";
import { ExperimentUser, ExperimentUserProvider } from "../types/user";

type UserProperties = Record<
  string,
  string | number | boolean | (string | number | boolean)[]
>;

export class ConnectorUserProvider implements ExperimentUserProvider {
  private readonly identityStore: IdentityStore;
  constructor(identityStore: IdentityStore) {
    this.identityStore = identityStore;
  }

  async identityReady(ms: number): Promise<void> {
    const identity = this.identityStore.getIdentity();
    if (!identity.userId && !identity.deviceId) {
      return new Promise<void>((resolve, reject) => {
        let timeoutHandle: ReturnType<typeof safeGlobal.setTimeout> | undefined;
        const cleanup = () => {
          if (timeoutHandle != null) {
            safeGlobal.clearTimeout(timeoutHandle);
            timeoutHandle = undefined;
          }
          this.identityStore.removeIdentityListener(listener);
        };
        const listener = () => {
          cleanup();
          resolve();
        };

        timeoutHandle = safeGlobal.setTimeout(() => {
          cleanup();
          reject(
            Error(
              "Timed out waiting for Amplitude Analytics SDK to initialize. " +
                "You must ensure that the analytics SDK is initialized prior to calling fetch().",
            ),
          );
        }, ms);
        this.identityStore.addIdentityListener(listener);
      });
    }
  }

  async getUser(): Promise<ExperimentUser> {
    return this.getUserSync();
  }

  getUserSync(): ExperimentUser {
    const identity = this.identityStore.getIdentity();
    let userProperties: UserProperties | undefined;
    try {
      userProperties = identity.userProperties as UserProperties;
    } catch {
      console.warn("[Experiment] failed to cast user properties");
    }
    return {
      user_id: identity.userId,
      device_id: identity.deviceId,
      user_properties: userProperties,
    };
  }
}

export class ConnectorExposureTrackingProvider implements ExposureTrackingProvider {
  private readonly eventBridge: EventBridge;

  constructor(eventBridge: EventBridge) {
    this.eventBridge = eventBridge;
  }

  track(exposure: Exposure): void {
    this.eventBridge.logEvent({
      eventType: "$exposure",
      eventProperties: exposure,
    });
  }
}
