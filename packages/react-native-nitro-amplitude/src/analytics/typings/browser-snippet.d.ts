import { InstanceProxy } from "@amplitude/analytics-core";

declare global {
  // globalThis only includes `var` declarations

  var amplitude: InstanceProxy & { invoked: boolean };
}
