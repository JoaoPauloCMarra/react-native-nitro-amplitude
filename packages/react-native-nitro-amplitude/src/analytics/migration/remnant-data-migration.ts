import {
  Event,
  ILogger,
  STORAGE_PREFIX,
  Storage,
  UserSession,
} from "@amplitude/analytics-core";
import {
  getLegacyEvents,
  getLegacySessionData,
  removeLegacyEvent,
} from "../../native/context";

type LegacyEventKind = "event" | "identify" | "interceptedIdentify";

export default class RemnantDataMigration {
  eventsStorageKey: string;

  constructor(
    private readonly apiKey: string,
    private readonly instanceName: string | undefined,
    private readonly storage: Storage<Event[]> | undefined,
    private readonly firstRunSinceUpgrade: boolean,
    private readonly logger: ILogger | undefined,
  ) {
    this.eventsStorageKey = `${STORAGE_PREFIX}_${this.apiKey.substring(0, 10)}`;
  }

  async execute(): Promise<Omit<UserSession, "optOut">> {
    if (this.firstRunSinceUpgrade) {
      await this.moveIdentifies();
      await this.moveInterceptedIdentifies();
    }
    await this.moveEvents();

    return this.callNativeFunction(() =>
      Promise.resolve(getLegacySessionData(this.instanceName ?? "")),
    ).then((sessionData) => sessionData ?? {});
  }

  private async moveEvents() {
    await this.moveLegacyEvents("event");
  }

  private async moveIdentifies() {
    await this.moveLegacyEvents("identify");
  }

  private async moveInterceptedIdentifies() {
    await this.moveLegacyEvents("interceptedIdentify");
  }

  private async callNativeFunction<T>(
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await action();
    } catch (e) {
      this.logger?.error(`can't call native function: ${String(e)}`);
      return undefined;
    }
  }

  private callNativeAction(action: () => void) {
    try {
      action();
    } catch (e) {
      this.logger?.error(`can't call native function: ${String(e)}`);
    }
  }

  private async callStorageFunction<T>(
    action: () => Promise<T>,
  ): Promise<{ value: T } | undefined> {
    try {
      return { value: await action() };
    } catch (e) {
      this.logger?.error(`can't call storage function: ${String(e)}`);
      return undefined;
    }
  }

  private async moveLegacyEvents(eventKind: LegacyEventKind) {
    const legacyJsonEvents = await this.callNativeFunction(() =>
      Promise.resolve(getLegacyEvents(this.instanceName ?? "", eventKind)),
    );
    if (!this.storage || !legacyJsonEvents || legacyJsonEvents.length === 0) {
      return;
    }

    const existingEvents = await this.callStorageFunction<Event[] | undefined>(
      async () => {
        return this.storage?.get(this.eventsStorageKey);
      },
    );
    if (!existingEvents) {
      return;
    }
    const events: Event[] = existingEvents.value ?? [];
    const eventIds: number[] = [];

    legacyJsonEvents.forEach((jsonEvent) => {
      const event = this.convertLegacyEvent(jsonEvent);
      if (event) {
        events.push(event);
        if (event.event_id !== undefined) {
          eventIds.push(event.event_id);
        }
      }
    });

    const writeSucceeded = await this.callStorageFunction(async () => {
      await this.storage?.set(this.eventsStorageKey, events);
      return true;
    });
    if (!writeSucceeded?.value) {
      return;
    }
    eventIds.forEach((eventId) =>
      this.callNativeAction(() =>
        removeLegacyEvent(this.instanceName ?? "", eventKind, eventId),
      ),
    );
  }

  private convertLegacyEvent(legacyJsonEvent: string): Event | null {
    try {
      const event = JSON.parse(legacyJsonEvent) as Event;

      const { library, timestamp, uuid, api_properties } = event as any;
      if (library !== undefined) {
        event.library = `${library.name}/${library.version}`;
      }
      if (timestamp !== undefined) {
        event.time = timestamp;
      }
      if (uuid !== undefined) {
        event.insert_id = uuid;
      }

      if (api_properties) {
        const {
          androidADID,
          android_app_set_id,
          ios_idfa,
          ios_idfv,
          productId,
          quantity,
          price,
          location,
        } = api_properties;
        if (androidADID !== undefined) {
          event.adid = androidADID;
        }
        if (android_app_set_id !== undefined) {
          event.android_app_set_id = android_app_set_id;
        }
        if (ios_idfa !== undefined) {
          event.idfa = ios_idfa;
        }
        if (ios_idfv !== undefined) {
          event.idfv = ios_idfv;
        }
        if (productId !== undefined) {
          event.productId = productId;
        }
        if (quantity !== undefined) {
          event.quantity = quantity;
        }
        if (price !== undefined) {
          event.price = price;
        }
        if (location !== undefined) {
          const { lat, lng } = location;
          event.location_lat = lat;
          event.location_lng = lng;
        }
      }

      const {
        $productId: productId,
        $quantity: quantity,
        $price: price,
        $revenueType: revenueType,
      } = event as any;
      if (productId !== undefined) {
        event.productId = productId;
      }
      if (quantity !== undefined) {
        event.quantity = quantity;
      }
      if (price !== undefined) {
        event.price = price;
      }
      if (revenueType !== undefined) {
        event.revenueType = revenueType;
      }

      return event;
    } catch {
      // skip invalid events
      return null;
    }
  }
  // eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
}
