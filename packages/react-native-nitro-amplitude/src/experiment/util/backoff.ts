import { safeGlobal } from "@amplitude/experiment-core";

const runtimeGlobal = safeGlobal ?? globalThis;

export class Backoff {
  private readonly attempts: number;
  private readonly min: number;
  private readonly max: number;
  private readonly scalar: number;

  private started = false;
  private done = false;
  private onDone: (() => void) | undefined;

  private timeoutHandle:
    ReturnType<typeof runtimeGlobal.setTimeout> | undefined;

  public constructor(
    attempts: number,
    min: number,
    max: number,
    scalar: number,
  ) {
    this.attempts = attempts;
    this.min = min;
    this.max = max;
    this.scalar = scalar;
  }

  public start(fn: () => Promise<void>, onDone?: () => void): void {
    this.onDone = onDone;
    if (!this.started) {
      this.started = true;
    } else {
      throw Error("Backoff already started");
    }
    this.backoff(fn, 0, this.min);
  }

  public cancel(): void {
    this.done = true;
    if (this.timeoutHandle != null) {
      runtimeGlobal.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
  }

  private finish(): void {
    this.done = true;
    const onDone = this.onDone;
    this.onDone = undefined;
    onDone?.();
  }

  private applyJitter(delay: number): number {
    const factor = 1 + (Math.random() - 0.5) * 0.4;
    return Math.min(Math.round(delay * factor), this.max);
  }

  private backoff(
    fn: () => Promise<void>,
    attempt: number,
    delay: number,
  ): void {
    if (this.done) {
      return;
    }
    this.timeoutHandle = runtimeGlobal.setTimeout(async () => {
      try {
        this.timeoutHandle = undefined;
        await fn();
        this.finish();
      } catch (e) {
        const nextAttempt = attempt + 1;
        if (!this.done && nextAttempt < this.attempts) {
          const nextDelay = Math.min(delay * this.scalar, this.max);
          this.backoff(fn, nextAttempt, nextDelay);
        } else {
          this.finish();
        }
      }
    }, this.applyJitter(delay));
  }
}
