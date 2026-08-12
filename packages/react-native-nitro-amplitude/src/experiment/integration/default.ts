import {
  AnalyticsConnector,
  ApplicationContext,
} from "@amplitude/analytics-connector";
import { Poller } from "@amplitude/experiment-core";

import { ExperimentUser, ExperimentUserProvider } from "../types/user";
import { isNative } from "../util/platform";

import {
  EXPERIMENT_CONTEXT_OPTIONS,
  getNativeApplicationContext,
} from "../../native/context";
import { ConnectorUserProvider } from "./connector";

export class DefaultUserProvider implements ExperimentUserProvider {
  public baseProvider: ExperimentUserProvider | null;
  private readonly applicationContext: ApplicationContext;
  public cachedUser: ExperimentUser = {};
  public cachedApplicationContext?: Record<string, string>;
  private readonly poller: Poller = new Poller(() => this.load(), 1000);

  constructor(baseProvider: ExperimentUserProvider | null = null) {
    this.baseProvider = baseProvider;
    this.applicationContext =
      AnalyticsConnector.getInstance(
        "context",
      ).applicationContextProvider.getApplicationContext();
  }

  public start(): void {
    void this.load();
    if (this.shouldPollUserCache()) {
      this.poller.start();
    }
  }

  public stop(): void {
    this.poller.stop();
  }

  /**
   * The variant method is not async
   */
  async load(): Promise<void> {
    try {
      this.cachedUser = await this.getUser();
    } catch {
      this.cachedUser = this.cachedUser || {};
    }
  }

  async getApplicationContext(): Promise<Record<string, string>> {
    if (this.cachedApplicationContext) {
      return this.cachedApplicationContext;
    } else if (isNative()) {
      try {
        this.cachedApplicationContext = getNativeApplicationContext(
          EXPERIMENT_CONTEXT_OPTIONS,
        );
      } catch {
        this.cachedApplicationContext = {};
      }
      return this.cachedApplicationContext;
    } else {
      this.cachedApplicationContext = this.applicationContext;
      return this.cachedApplicationContext;
    }
  }

  getUserSync(): ExperimentUser {
    const context = this.cachedApplicationContext ?? {};
    let user: ExperimentUser = this.cachedUser;
    if (this.baseProvider instanceof ConnectorUserProvider) {
      const connectorProvider = this.baseProvider;
      user = connectorProvider.getUserSync();
    }
    return {
      ...context,
      ...user,
    };
  }

  async getUser(): Promise<ExperimentUser> {
    const context = await this.getApplicationContext();
    const baseUser = await this.baseProvider?.getUser();
    return {
      ...context,
      ...(baseUser ?? {}),
    };
  }

  private shouldPollUserCache(): boolean {
    return (
      !!this.baseProvider &&
      !(this.baseProvider instanceof ConnectorUserProvider)
    );
  }
}
