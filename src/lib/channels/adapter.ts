// Channel adapter interface. Every ad platform (Media.net, Google Ads, Meta) implements this.
// MVP ships only the mock adapter; delivery itself is simulated by src/lib/sim/engine.ts.

export interface ChannelCaps {
  dailyBudgetPaise: number;
  lifetimeBudgetPaise: number;
  freqCapDay: number;
  freqCapWeek: number;
}

export interface ChannelAdapter {
  readonly channel: string;
  launch(input: { campaignCode: string; caps: ChannelCaps; audienceSize: number; landingUrl: string }): Promise<{ externalId: string }>;
  pause(externalId: string): Promise<void>;
  resume(externalId: string): Promise<void>;
  stop(externalId: string): Promise<void>;
  setCaps(externalId: string, caps: ChannelCaps): Promise<void>;
}

export class AdapterError extends Error {
  status = 502;
}

class MockMediaNetAdapter implements ChannelAdapter {
  readonly channel = "medianet";
  private failureRate = Number(process.env.MOCK_ADAPTER_FAILURE_RATE ?? 0);

  private async call(op: string): Promise<void> {
    // Simulate network latency and (optionally) failures to exercise retries + fallbacks.
    await new Promise((r) => setTimeout(r, 40));
    if (Math.random() < this.failureRate) throw new AdapterError(`Media.net (mock) ${op} failed. Try again.`);
  }

  async launch(input: { campaignCode: string }) {
    await this.call("launch");
    return { externalId: `mn_${input.campaignCode.toLowerCase()}_${Date.now().toString(36)}` };
  }
  async pause() {
    await this.call("pause");
  }
  async resume() {
    await this.call("resume");
  }
  async stop() {
    await this.call("stop");
  }
  async setCaps() {
    await this.call("setCaps");
  }
}

/** Retries an adapter command (pause/stop must be reliable: they're the kill switch). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
  throw last;
}

let instance: ChannelAdapter | undefined;
export function getAdapter(): ChannelAdapter {
  instance ??= new MockMediaNetAdapter();
  return instance;
}
