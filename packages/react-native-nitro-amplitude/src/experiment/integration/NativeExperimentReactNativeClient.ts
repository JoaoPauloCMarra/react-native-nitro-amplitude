import { NativeModules, TurboModuleRegistry } from "react-native";
import type { TurboModule } from "react-native";

export interface Spec extends TurboModule {
  getApplicationContext(): Promise<{
    version?: string;
    platform?: string;
    language?: string;
    os?: string;
    device_brand?: string;
    device_manufacturer?: string;
    device_model?: string;
    carrier?: string;
  }>;
}

const turboModule = TurboModuleRegistry.get<Spec>(
  "ExperimentReactNativeClient",
);
const legacyModule = NativeModules.ExperimentReactNativeClient as
  | Spec
  | undefined
  | null;

export default turboModule ?? legacyModule;
