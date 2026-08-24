import {
  AppState,
  AppStateStatus,
  NativeEventSubscription,
} from "react-native";
import {
  AmplitudeCore,
  Destination,
  UUID,
  returnWrapper,
  debugWrapper,
  getClientLogConfig,
  getClientStates,
  ReactNativeConfig,
  ReactNativeOptions,
  ReactNativeAttributionOptions as AttributionOptions,
  IIdentify,
  EventOptions,
  Event,
  Result,
  ReactNativeClient,
  NavigationState,
  Campaign,
  IdentityEventSender,
  getAnalyticsConnector,
  setConnectorDeviceId,
  setConnectorUserId,
  SpecialEventType,
  AnalyticsClient,
} from "@amplitude/analytics-core";
import { healthCheck } from "../diagnostics";
import {
  classifyDiagnosticFailure,
  recordDiagnosticFailure,
} from "../diagnostic-failures";
import { CampaignTracker } from "./campaign/campaign-tracker";
import { Context } from "./plugins/context";
import { useReactNativeConfig, createCookieStorage } from "./config";
import { parseOldCookies } from "./cookie-migration";
import { isNative } from "./utils/platform";

const START_SESSION_EVENT = "session_start";
const END_SESSION_EVENT = "session_end";

function normalizeAppState(value: unknown): AppStateStatus {
  switch (value) {
    case "active":
    case "background":
    case "inactive":
    case "unknown":
    case "extension":
      return value;
    default:
      return "background";
  }
}

type ScheduledDestination = {
  scheduleId?: ReturnType<typeof setTimeout> | null;
  flushId?: ReturnType<typeof setTimeout> | null;
  queue?: unknown[];
  flush?: (useRetry?: boolean) => Promise<void>;
  resetSchedule?: () => void;
  scheduleEvents?: (list: unknown[]) => void;
  fulfillRequest?: (list: unknown[], code: number, message: string) => unknown;
};

type DestinationFlushState = {
  destination: ScheduledDestination;
  originalFlush: (useRetry?: boolean) => Promise<void>;
  chain: Promise<void>;
};

type FlushOutcome = {
  code: number;
  count: number;
  message: string;
};

export type AmplitudeReactNativeClient = ReactNativeClient & {
  shutdown: () => void;
  flushWithResult: () => Promise<AmplitudeFlushResult>;
  getDiagnostics: () => AmplitudeAnalyticsDiagnostics;
  healthCheck: () => Promise<AmplitudeHealthCheckResult>;
};

export type AmplitudeFlushResult = {
  ok: boolean;
  sent: number;
  failed: number;
  dropped: number;
  retried: number;
  reason?: string;
  result?: Result;
  finishedAt: number;
};

export type AmplitudeAnalyticsDiagnostics = {
  initialized: boolean;
  instanceName?: string;
  userId?: string;
  deviceId?: string;
  sessionId?: number;
  queueSize: number;
  lastFlushTime?: number;
  lastFlushDurationMillis?: number;
  lastFlushError?: string;
  activeInstanceNames: string[];
};

export type AmplitudeHealthCheckResult = {
  ok: boolean;
  analyticsInitialized: boolean;
  nativeAvailable: boolean;
  storageWritable: boolean;
  diskStorageWritable: boolean;
  workerReady: boolean;
  errors: string[];
};

let nextConnectorOwnerId = 0;
const activeConnectorOwnerIds = new Map<string, number>();

export function getActiveAnalyticsInstanceNames(): string[] {
  return Array.from(activeConnectorOwnerIds.keys()).sort();
}

export class AmplitudeReactNative
  extends AmplitudeCore
  implements ReactNativeClient, AnalyticsClient
{
  appState: AppStateStatus = "background";
  private appStateChangeHandler: NativeEventSubscription | undefined;
  private initPromise: Promise<void> | undefined;
  private readonly connectorOwnerId = ++nextConnectorOwnerId;
  private lastFlushTime: number | undefined;
  private lastFlushDurationMillis: number | undefined;
  private lastFlushError: string | undefined;
  private lastScreenName: string | undefined;
  private flushChain: Promise<void> = Promise.resolve();
  private flushActive = false;
  private readonly destinationFlushStates = new WeakMap<
    object,
    DestinationFlushState
  >();
  private destinationFlushStateList: DestinationFlushState[] = [];
  explicitSessionId: number | undefined;

  // @ts-ignore
  config: ReactNativeConfig;
  override userProperties: Record<string, unknown> | undefined;

  init(apiKey = "", userId?: string, options?: ReactNativeOptions) {
    this.initPromise =
      this.initPromise ??
      this._init({ ...options, userId, apiKey }).finally(() => {
        this.initPromise = undefined;
      });
    return returnWrapper(this.initPromise);
  }

  trackScreenView(
    screenName: string,
    eventProperties?: Record<string, unknown>,
    eventOptions?: EventOptions,
  ) {
    return this.track(
      "[Amplitude] Screen Viewed",
      {
        "[Amplitude] Screen Name": screenName,
        ...eventProperties,
      },
      eventOptions,
    );
  }

  trackScreenViewOnNavigationStateChange(
    navigationState: NavigationState | undefined,
    eventProperties?: Record<string, unknown>,
    eventOptions?: EventOptions,
  ) {
    let currentState = navigationState;
    let screenName: string | undefined;

    while (currentState) {
      const route = currentState.routes[currentState.index];
      if (!route) {
        return returnWrapper(Promise.resolve(undefined));
      }
      screenName = route.name;
      currentState = route.state;
    }

    if (!screenName || screenName === this.lastScreenName) {
      return returnWrapper(Promise.resolve(undefined));
    }

    this.lastScreenName = screenName;
    return this.trackScreenView(screenName, eventProperties, eventOptions);
  }

  protected override async _init(
    options: ReactNativeOptions & { apiKey: string },
  ) {
    // Step 0: Block concurrent initialization
    if (this.initializing) {
      return;
    }
    this.initializing = true;
    this.lastScreenName = undefined;
    this.explicitSessionId = options.sessionId;
    let appStateHandlerInstalled = false;

    try {
      // Step 1: Read cookies stored by old SDK
      const oldCookies = await parseOldCookies(options.apiKey, options);

      // Step 2: Create react native config
      const reactNativeOptions = await useReactNativeConfig(options.apiKey, {
        ...options,
        deviceId: options.deviceId ?? oldCookies.deviceId,
        sessionId: oldCookies.sessionId,
        optOut: options.optOut ?? oldCookies.optOut,
        lastEventTime: oldCookies.lastEventTime,
        userId: options.userId ?? oldCookies.userId,
      });
      await super._init(reactNativeOptions);

      // Set up the analytics connector to integrate with the experiment SDK.
      // Send events from the experiment SDK and forward identifies to the
      // identity store.
      const connectorInstanceName = this.getConnectorInstanceName();
      const connector = getAnalyticsConnector(connectorInstanceName);
      connector.identityStore.setIdentity({
        userId: this.config.userId,
        deviceId: this.config.deviceId,
      });

      // Step 3: Install plugins
      // Do not track any events before this
      await this.add(new Destination()).promise;
      await this.add(new Context()).promise;
      await this.add(new IdentityEventSender()).promise;
      this.installDestinationFlushBarriers();

      // Step 4: Manage session
      this.appState = normalizeAppState(AppState.currentState);
      const isNewSession = this.startNewSessionIfNeeded(
        this.currentTimeMillis(),
      );
      this.config.loggerProvider?.log(
        `Init: startNewSessionIfNeeded = ${isNewSession ? "yes" : "no"}, sessionId = ${
          this.getSessionId() ?? "undefined"
        }`,
      );
      this.appStateChangeHandler?.remove();
      this.appStateChangeHandler = AppState.addEventListener(
        "change",
        this.handleAppStateChange,
      );
      appStateHandlerInstalled = true;

      // Step 5: Track attributions
      await this.runAttributionStrategy(options.attribution, isNewSession);

      // Step 6: Run queued functions
      await this.runQueuedFunctions("dispatchQ");

      // Step 7: Add the event receiver after running remaining queued functions.
      connector.eventBridge.setEventReceiver((event) => {
        this.handleInternalTrackPromise(
          this.track(event.eventType, event.eventProperties).promise,
        );
      });
      activeConnectorOwnerIds.set(connectorInstanceName, this.connectorOwnerId);
    } catch (error) {
      if (appStateHandlerInstalled) {
        this.appStateChangeHandler?.remove();
        this.appStateChangeHandler = undefined;
      }
      throw error;
    } finally {
      this.initializing = false;
    }
  }

  shutdown() {
    void this.shutdownAndFlush();
  }

  private async shutdownAndFlush(): Promise<void> {
    if (this.config && this.isReady) {
      try {
        await this.flush().promise;
      } catch {
        // teardown must still run even when the final flush fails
      }
    }
    this.teardown();
  }

  private teardown() {
    this.appStateChangeHandler?.remove();
    this.appStateChangeHandler = undefined;

    this.cancelDestinationFlushes();
    this.timeline.reset(this);
    this.destinationFlushStateList = [];
    this.q = [];
    this.dispatchQ = [];
    this.isReady = false;
    this.lastScreenName = undefined;

    const connectorInstanceName = this.config
      ? this.getConnectorInstanceName()
      : undefined;
    if (
      connectorInstanceName &&
      activeConnectorOwnerIds.get(connectorInstanceName) ===
        this.connectorOwnerId
    ) {
      const connector = getAnalyticsConnector(connectorInstanceName);
      connector.eventBridge.setEventReceiver(() => undefined);
      connector.identityStore.setIdentity({});
      activeConnectorOwnerIds.delete(connectorInstanceName);
    }
  }

  private handleInternalTrackPromise(promise: Promise<unknown>) {
    void promise.catch((error) => {
      this.config?.loggerProvider?.error(
        `Internal track call failed: ${String(error)}`,
      );
    });
  }

  private getConnectorInstanceName() {
    return this.config.instanceName ?? "$default_instance";
  }

  private cancelDestinationFlushes() {
    this.timeline.plugins.forEach((plugin) => {
      if (plugin.type !== "destination") {
        return;
      }

      const destination = plugin as ScheduledDestination;
      if (destination.scheduleId) {
        clearTimeout(destination.scheduleId);
      }
      if (destination.flushId) {
        clearTimeout(destination.flushId);
      }
      destination.resetSchedule?.();
      destination.flushId = null;
      destination.queue = [];
    });
  }

  async runAttributionStrategy(
    attributionConfig?: AttributionOptions,
    isNewSession = false,
  ) {
    if (isNative()) {
      return;
    }
    const track = (...args: Parameters<typeof this.track>) =>
      this.track(...args).promise;
    const onNewCampaign = this.setSessionId.bind(
      this,
      this.currentTimeMillis(),
    );

    const storage = await createCookieStorage<Campaign>(this.config);
    const campaignTracker = new CampaignTracker(this.config.apiKey, {
      ...attributionConfig,
      storage,
      track,
      onNewCampaign,
    });

    await campaignTracker.send(isNewSession);
  }

  getUserId() {
    return this.config?.userId;
  }

  setUserId(userId: string | undefined) {
    if (!this.config) {
      this.q.push(this.setUserId.bind(this, userId));
      return;
    }
    this.config.userId = userId;
    setConnectorUserId(userId, this.getConnectorInstanceName());
  }

  getDeviceId() {
    return this.config?.deviceId;
  }

  setDeviceId(deviceId: string) {
    if (!this.config) {
      this.q.push(this.setDeviceId.bind(this, deviceId));
      return;
    }
    this.config.deviceId = deviceId;
    setConnectorDeviceId(deviceId, this.getConnectorInstanceName());
  }

  override identify(identify: IIdentify, eventOptions?: EventOptions) {
    if (eventOptions?.user_id) {
      this.setUserId(eventOptions.user_id);
    }
    if (eventOptions?.device_id) {
      this.setDeviceId(eventOptions.device_id);
    }
    return super.identify(identify, eventOptions);
  }

  reset() {
    this.setUserId(undefined);
    this.setDeviceId(UUID());
  }

  getSessionId() {
    return this.config?.sessionId;
  }

  private enqueueFlush<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.flushActive
      ? this.flushChain.then(operation)
      : (() => {
          try {
            return operation();
          } catch (error) {
            return Promise.reject(error);
          }
        })();
    this.flushActive = true;
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    this.flushChain = settled;
    void settled.then(() => {
      if (this.flushChain === settled) {
        this.flushActive = false;
      }
    });
    return current;
  }

  private async performFlush(): Promise<void> {
    this.installDestinationFlushBarriers();
    const drainNativeStorage = () => {
      if (!isNative()) {
        return;
      }
      const { flushPendingDiskWrites } =
        require("../native/storage") as typeof import("../native/storage");
      flushPendingDiskWrites(this.getStorageErrorHandler());
    };

    drainNativeStorage();
    let flushError: unknown;
    try {
      await super.flush().promise;
    } catch (error) {
      flushError = error;
    }

    try {
      await this.waitForDestinationFlushes();
      drainNativeStorage();
      await this.waitForDestinationFlushes();
      drainNativeStorage();
    } catch (error) {
      flushError ??= error;
    }

    if (flushError !== undefined) {
      throw flushError;
    }
  }

  private installDestinationFlushBarriers(): void {
    this.timeline.plugins.forEach((plugin) => {
      if (plugin.type !== "destination") {
        return;
      }

      const destination = plugin as ScheduledDestination;
      if (
        typeof destination.flush !== "function" ||
        this.destinationFlushStates.has(destination)
      ) {
        return;
      }

      const state: DestinationFlushState = {
        destination,
        originalFlush: destination.flush.bind(destination),
        chain: Promise.resolve(),
      };
      destination.flush = (useRetry = false) => {
        const current = state.chain
          .catch(() => undefined)
          .then(() => this.runDestinationFlush(state, useRetry));
        state.chain = current.then(
          () => undefined,
          () => undefined,
        );
        if (!useRetry) {
          return current;
        }
        return current.catch((error) => {
          this.config?.loggerProvider?.error(
            `Automatic destination flush failed: ${String(error)}`,
          );
        });
      };
      this.destinationFlushStates.set(destination, state);
      this.destinationFlushStateList.push(state);
    });
  }

  private async runDestinationFlush(
    state: DestinationFlushState,
    useRetry: boolean,
  ): Promise<void> {
    const scheduledFlush =
      state.destination.flushId ?? state.destination.scheduleId ?? null;
    let flushError: unknown;
    try {
      await state.originalFlush(useRetry);
    } catch (error) {
      flushError = error;
    }

    if (scheduledFlush !== null) {
      clearTimeout(scheduledFlush);
    }

    if (flushError !== undefined) {
      this.recoverDestinationFlush(state.destination);
    }

    if (isNative()) {
      const { flushPendingDiskWrites } =
        require("../native/storage") as typeof import("../native/storage");
      try {
        flushPendingDiskWrites(this.getStorageErrorHandler());
      } catch (error) {
        flushError ??= error;
      }
    }

    if (flushError !== undefined) {
      throw flushError;
    }
  }

  private recoverDestinationFlush(destination: ScheduledDestination): void {
    let recoveryError: unknown;
    const flushId = destination.flushId;
    const scheduleId = destination.scheduleId;

    try {
      if (flushId !== null && flushId !== undefined) {
        clearTimeout(flushId);
      }
      if (
        scheduleId !== null &&
        scheduleId !== undefined &&
        scheduleId !== flushId
      ) {
        clearTimeout(scheduleId);
      }
    } catch (error) {
      recoveryError = error;
    }

    try {
      destination.resetSchedule?.();
    } catch (error) {
      recoveryError ??= error;
    }

    destination.scheduleId = null;
    destination.flushId = null;

    const queue = destination.queue;
    if (
      queue &&
      queue.length > 0 &&
      typeof destination.scheduleEvents === "function"
    ) {
      try {
        destination.scheduleEvents(queue);
      } catch (error) {
        recoveryError ??= error;
      }
    }

    if (recoveryError !== undefined) {
      this.config?.loggerProvider?.error(
        `Destination flush recovery failed: ${String(recoveryError)}`,
      );
    }
  }

  private getStorageErrorHandler(): ((message: string) => void) | undefined {
    const logger = this.config?.loggerProvider;
    return logger ? (message) => logger.error(message) : undefined;
  }

  private async waitForDestinationFlushes(): Promise<void> {
    while (this.destinationFlushStateList.length > 0) {
      const states = [...this.destinationFlushStateList];
      const chains = states.map((state) => state.chain);
      await Promise.all(chains);
      await Promise.resolve();
      if (states.every((state, index) => state.chain === chains[index])) {
        return;
      }
    }
  }

  override flush() {
    return returnWrapper(this.enqueueFlush(() => this.performFlush()));
  }

  async flushWithResult(): Promise<AmplitudeFlushResult> {
    return this.enqueueFlush(() => this.flushWithResultInternal());
  }

  private async flushWithResultInternal(): Promise<AmplitudeFlushResult> {
    const queueSize = this.getQueueSize();
    const collector = this.collectFlushOutcomes();
    const startedAt = Date.now();
    try {
      await this.performFlush();
      const outcomes = collector.finish();
      this.lastFlushTime = Date.now();
      this.lastFlushDurationMillis = this.lastFlushTime - startedAt;
      const remainingQueueSize = this.getQueueSize();
      const failedOutcomes = outcomes.filter(
        (outcome) => !this.isSuccessStatusCode(outcome.code),
      );
      this.recordFlushOutcomeDiagnostics(failedOutcomes, remainingQueueSize);
      const dropped = failedOutcomes.reduce(
        (total, outcome) => total + outcome.count,
        0,
      );
      if (remainingQueueSize > 0) {
        this.lastFlushError = `Flush completed with ${remainingQueueSize} queued event(s) remaining`;
        return {
          ok: false,
          sent: this.countSuccessfulOutcomes(outcomes),
          failed: dropped,
          dropped,
          retried: remainingQueueSize,
          reason: this.lastFlushError,
          finishedAt: this.lastFlushTime,
        };
      }
      if (dropped > 0) {
        this.lastFlushError =
          failedOutcomes[0]?.message ??
          `Flush dropped ${dropped} event(s) without retry`;
        return {
          ok: false,
          sent: this.countSuccessfulOutcomes(outcomes),
          failed: dropped,
          dropped,
          retried: 0,
          reason: this.lastFlushError,
          finishedAt: this.lastFlushTime,
        };
      }
      this.lastFlushError = undefined;
      return {
        ok: true,
        sent: this.countSuccessfulOutcomes(outcomes) || queueSize,
        failed: 0,
        dropped: 0,
        retried: 0,
        finishedAt: this.lastFlushTime,
      };
    } catch (error) {
      collector.finish();
      this.lastFlushTime = Date.now();
      this.lastFlushDurationMillis = this.lastFlushTime - startedAt;
      this.lastFlushError =
        error instanceof Error ? error.message : String(error);
      recordDiagnosticFailure({
        operation: "analytics_upload",
        kind: classifyDiagnosticFailure(error),
        queuedEventCount: queueSize,
      });
      return {
        ok: false,
        sent: 0,
        failed: 0,
        dropped: 0,
        retried: queueSize,
        reason: this.lastFlushError,
        finishedAt: this.lastFlushTime,
      };
    }
  }

  getDiagnostics(): AmplitudeAnalyticsDiagnostics {
    return {
      initialized: Boolean(this.config && this.isReady),
      instanceName: this.config?.instanceName,
      userId: this.getUserId(),
      deviceId: this.getDeviceId(),
      sessionId: this.getSessionId(),
      queueSize: this.getQueueSize(),
      lastFlushTime: this.lastFlushTime,
      lastFlushDurationMillis: this.lastFlushDurationMillis,
      lastFlushError: this.lastFlushError,
      activeInstanceNames: getActiveAnalyticsInstanceNames(),
    };
  }

  async healthCheck(): Promise<AmplitudeHealthCheckResult> {
    return healthCheck(this);
  }

  getIdentity() {
    return {
      userId: this.getUserId(),
      deviceId: this.getDeviceId(),
      userProperties: this.userProperties,
    };
  }

  getOptOut() {
    return this.config?.optOut;
  }

  setSessionId(sessionId: number) {
    if (!this.config) {
      this.q.push(this.setSessionId.bind(this, sessionId));
      return;
    }

    this.explicitSessionId = sessionId;
    this.setSessionIdInternal(sessionId, this.currentTimeMillis());
  }

  extendSession() {
    if (!this.config) {
      this.q.push(this.extendSession.bind(this));
      return;
    }
    this.config.lastEventTime = this.currentTimeMillis();
  }

  private getQueueSize(): number {
    let queueSize =
      this.q.length + this.dispatchQ.length + this.timeline.queue.length;
    this.timeline.plugins.forEach((plugin) => {
      if (plugin.type !== "destination") {
        return;
      }
      const destination = plugin as ScheduledDestination;
      queueSize += destination.queue?.length ?? 0;
    });
    return queueSize;
  }

  private collectFlushOutcomes(): { finish: () => FlushOutcome[] } {
    const outcomes: FlushOutcome[] = [];
    const restorers: (() => void)[] = [];

    this.timeline.plugins.forEach((plugin) => {
      if (plugin.type !== "destination") {
        return;
      }

      const destination = plugin as ScheduledDestination;
      if (!destination.fulfillRequest) {
        return;
      }

      const original = destination.fulfillRequest;
      destination.fulfillRequest = (list, code, message) => {
        outcomes.push({ code, count: list.length, message });
        return original.call(destination, list, code, message);
      };
      restorers.push(() => {
        destination.fulfillRequest = original;
      });
    });

    return {
      finish: () => {
        while (restorers.length > 0) {
          restorers.pop()?.();
        }
        return outcomes;
      },
    };
  }

  private countSuccessfulOutcomes(outcomes: FlushOutcome[]): number {
    return outcomes.reduce((total, outcome) => {
      if (!this.isSuccessStatusCode(outcome.code)) {
        return total;
      }
      return total + outcome.count;
    }, 0);
  }

  private isSuccessStatusCode(code: number): boolean {
    return code >= 200 && code < 300;
  }

  private recordFlushOutcomeDiagnostics(
    failedOutcomes: FlushOutcome[],
    queuedEventCount: number,
  ): void {
    failedOutcomes.forEach((outcome) => {
      const maxRetriesExceeded = /exceeded retry count/i.test(outcome.message);
      recordDiagnosticFailure({
        operation: "analytics_upload",
        kind: classifyDiagnosticFailure(outcome.message, outcome.code),
        httpStatus: outcome.code > 0 ? outcome.code : undefined,
        batchSize: outcome.count,
        queuedEventCount,
        retryCount: maxRetriesExceeded
          ? this.config.flushMaxRetries
          : undefined,
        maxRetriesExceeded,
      });
    });
  }

  private setSessionIdInternal(sessionId: number, eventTime: number) {
    const previousSessionId = this.config.sessionId;
    if (previousSessionId === sessionId) {
      return;
    }

    this.config.sessionId = sessionId;

    if (this.config.trackingSessionEvents) {
      this.config.loggerProvider?.log(
        `SESSION_END event: previousSessionId = ${previousSessionId ?? "undefined"}`,
      );

      if (previousSessionId !== undefined) {
        const sessionEndEvent: Event = {
          event_type: END_SESSION_EVENT,
          time:
            this.config.lastEventTime !== undefined
              ? this.config.lastEventTime + 1
              : sessionId, // increment lastEventTime to sort events properly in UI - session_end should be the last event in a session
          session_id: previousSessionId,
        };
        this.handleInternalTrackPromise(this.track(sessionEndEvent).promise);
      }

      this.config.loggerProvider?.log(
        `SESSION_START event: sessionId = ${sessionId}`,
      );
      const sessionStartEvent: Event = {
        event_type: START_SESSION_EVENT,
        time: eventTime,
        session_id: sessionId,
      };
      this.handleInternalTrackPromise(this.track(sessionStartEvent).promise);
    }

    this.config.lastEventTime = eventTime;
  }

  override async process(event: Event): Promise<Result> {
    if (!this.config.optOut) {
      const eventTime = event.time ?? this.currentTimeMillis();
      if (event.time === undefined) {
        event = { ...event, time: eventTime };
      }

      const isSessionEvent =
        event.event_type === START_SESSION_EVENT ||
        event.event_type === END_SESSION_EVENT;
      const isCustomEventSessionId =
        !isSessionEvent &&
        event.session_id != undefined &&
        event.session_id !== this.getSessionId();
      if (!isCustomEventSessionId) {
        if (!isSessionEvent) {
          if (this.appState !== "active") {
            this.startNewSessionIfNeeded(eventTime);
          }
        }
        this.config.lastEventTime = eventTime;
      }

      if (event.session_id == undefined) {
        event.session_id = this.getSessionId();
      }

      if (event.event_id === undefined) {
        const eventId = (this.config.lastEventId ?? 0) + 1;
        event = { ...event, event_id: eventId };
        this.config.lastEventId = eventId;
      }
    }

    // Set user properties
    if (
      event.event_type === SpecialEventType.IDENTIFY &&
      event.user_properties
    ) {
      this.userProperties = this.getOperationAppliedUserProperties(
        event.user_properties,
      );
    }

    return super.process(event);
  }

  currentTimeMillis() {
    return Date.now();
  }

  private startNewSessionIfNeeded(timestamp: number): boolean {
    const sessionId = this.explicitSessionId ?? timestamp;

    const shouldStartNewSession = this.shouldStartNewSession(timestamp);
    if (shouldStartNewSession) {
      this.setSessionIdInternal(sessionId, timestamp);
    } else {
      this.config.lastEventTime = timestamp;
    }

    return shouldStartNewSession;
  }

  private shouldStartNewSession(timestamp: number): boolean {
    const sessionId = this.explicitSessionId ?? timestamp;

    return (
      !this.inSession() ||
      (this.explicitSessionId !== this.config.sessionId &&
        (this.explicitSessionId !== undefined ||
          !this.isWithinMinTimeBetweenSessions(sessionId)))
    );
  }

  private isWithinMinTimeBetweenSessions(timestamp: number) {
    return (
      timestamp - (this.config.lastEventTime ?? 0) < this.config.sessionTimeout
    );
  }

  private inSession() {
    return this.config.sessionId != undefined;
  }

  private readonly handleAppStateChange = (nextAppState: AppStateStatus) => {
    const currentAppState = this.appState;
    this.appState = nextAppState;
    if (currentAppState !== nextAppState) {
      const timestamp = this.currentTimeMillis();
      if (
        isNative() &&
        (nextAppState === "inactive" || nextAppState === "background")
      ) {
        const { flushPendingDiskWrites } =
          require("../native/storage") as typeof import("../native/storage");
        try {
          flushPendingDiskWrites(this.getStorageErrorHandler());
        } catch {}
      }
      if (nextAppState == "active") {
        this.enterForeground(timestamp);
      } else {
        this.exitForeground(timestamp);
      }
    }
  };

  private enterForeground(timestamp: number) {
    this.config.loggerProvider?.log("App Activated");
    return this.startNewSessionIfNeeded(timestamp);
  }

  private exitForeground(timestamp: number) {
    this.config.lastEventTime = timestamp;
  }
}

const DEBUG_METHOD_STATES = {
  init: ["config"],
  add: ["config.apiKey", "timeline.plugins"],
  remove: ["config.apiKey", "timeline.plugins"],
  track: ["config.apiKey", "timeline.queue.length"],
  trackScreenView: ["config.apiKey", "timeline.queue.length"],
  trackScreenViewOnNavigationStateChange: [
    "config.apiKey",
    "timeline.queue.length",
  ],
  logEvent: ["config.apiKey", "timeline.queue.length"],
  identify: ["config.apiKey", "timeline.queue.length"],
  groupIdentify: ["config.apiKey", "timeline.queue.length"],
  setGroup: ["config.apiKey", "timeline.queue.length"],
  revenue: ["config.apiKey", "timeline.queue.length"],
  flush: ["config.apiKey", "timeline.queue.length"],
  flushWithResult: ["config.apiKey", "timeline.queue.length"],
  getUserId: ["config", "config.userId"],
  setUserId: ["config", "config.userId"],
  getDeviceId: ["config", "config.deviceId"],
  setDeviceId: ["config", "config.deviceId"],
  reset: ["config", "config.userId", "config.deviceId"],
  getSessionId: ["config"],
  setSessionId: ["config"],
  extendSession: ["config"],
  setOptOut: ["config"],
  shutdown: ["config", "timeline.plugins"],
  getDiagnostics: ["config", "timeline.plugins"],
  healthCheck: ["config", "timeline.plugins"],
} as const satisfies Record<string, readonly string[]>;

type DebugWrappedMethod = keyof typeof DEBUG_METHOD_STATES &
  keyof AmplitudeReactNativeClient;

type ClientMethod = (...args: never[]) => unknown;

export const createInstance = (): AmplitudeReactNativeClient => {
  const client = new AmplitudeReactNative();
  const logConfig = getClientLogConfig(client);
  const wrapped = {} as Record<DebugWrappedMethod, ClientMethod>;
  for (const method of Object.keys(
    DEBUG_METHOD_STATES,
  ) as DebugWrappedMethod[]) {
    const fn = client[method] as ClientMethod;
    wrapped[method] = debugWrapper(
      fn.bind(client),
      method,
      logConfig,
      getClientStates(client, [...DEBUG_METHOD_STATES[method]]),
    );
  }
  return wrapped as unknown as AmplitudeReactNativeClient;
};

export default createInstance();
