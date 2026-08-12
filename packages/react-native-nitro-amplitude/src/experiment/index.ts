import { Experiment } from "./factory";
import { ExperimentClient } from "./experimentClient";
import { StubExperimentClient } from "./stubClient";
import { ConsoleLogger } from "./logger/consoleLogger";
import { LogLevel } from "./types/logger";
import type { Logger } from "./types/logger";
import { Source, VariantSource, isFallback } from "./types/source";
import { LocalStorage, MemoryStorage } from "./storage/local-storage";
import {
  variantBoolean,
  variantJson,
  variantNumber,
  variantPayload,
  variantString,
} from "./typed-variants";

export { Experiment };
export { ExperimentClient };
export { StubExperimentClient };
export { ConsoleLogger };
export { LogLevel };
export type { Logger };
export { Source, VariantSource, isFallback };
export { LocalStorage, MemoryStorage };
export {
  variantBoolean,
  variantJson,
  variantNumber,
  variantPayload,
  variantString,
};

export type { ExperimentConfig } from "./types/config";
export { Defaults } from "./types/config";
export type {
  Client,
  ExperimentFetchResult,
  ExperimentVariantResult,
  FetchOptions,
} from "./types/client";
export type { ExperimentUser, ExperimentUserProvider } from "./types/user";
export type { Exposure, ExposureTrackingProvider } from "./types/exposure";
export type { Variant, Variants } from "./types/variant";
export type { Storage } from "./types/storage";
