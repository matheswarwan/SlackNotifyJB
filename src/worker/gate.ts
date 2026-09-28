import { escapeSlack } from '../shared/template';
import { postMessage, type PostResult, type SlackEnv } from './slack';

// One ChannelGate Durable Object per Slack channel. Slack allows about one
// message per second per channel, and a journey can push thousands of contacts
// through an activity at once. The gate spaces messages out, sends up to
// maxPerHour individual messages per activity, and counts everything else
// into a summary that is posted every SUMMARY_INTERVAL_MS.
export const SPACING_MS = 1100;
export const MAX_WAIT_MS = 8000;
export const SUMMARY_INTERVAL_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface GateRequest { channel: string; text: string; journey: string; activity: string; maxPerHour: number }
export type GateOutcome = 'posted' | 'summarised' | 'failed';

interface Window { start: number; sent: number }
interface Pending { count: number; journey: string; activity: string; maxPerHour: number; overLimit: boolean }

export interface GateStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
}
export interface GateState { storage: GateStorage }

export interface GateDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  post: (channel: string, text: string) => Promise<PostResult>;
}

export function summaryText(p: Pending): string {
  const who = p.count === 1 ? '1 more contact' : `${p.count.toLocaleString('en-US')} more contacts`;
  const why = p.overLimit
    ? `Individual messages are paused while this activity is over its limit of ${p.maxPerHour} per hour.`
    : 'They arrived faster than Slack accepts messages (about one per second per channel).';
  return `…and ${who} reached *${escapeSlack(p.activity)}* in ${escapeSlack(p.journey)} in the last few minutes. ${why}`;
}

export class ChannelGate {
  private nextSlotAt = 0;
  private deps: GateDeps;

  constructor(private state: GateState, env: SlackEnv, deps?: Partial<GateDeps>) {
    this.deps = {
      now: () => Date.now(),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      post: (channel, text) => postMessage(env, channel, text),
      ...deps,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const body = await request.json() as GateRequest;
    return Response.json({ outcome: await this.send(body) });
  }

  async send(req: GateRequest): Promise<GateOutcome> {
    const now = this.deps.now();
    const label = `${req.journey}\u0000${req.activity}`;
    await this.state.storage.put('channel', req.channel);
    const windows = (await this.state.storage.get<Record<string, Window>>('windows')) ?? {};
    let win = windows[label];
    if (!win || now - win.start >= HOUR_MS) win = { start: now, sent: 0 };
    const wait = Math.max(0, this.nextSlotAt - now);
    if (win.sent >= req.maxPerHour || wait > MAX_WAIT_MS) {
      await this.defer(label, req, win.sent >= req.maxPerHour);
      return 'summarised';
    }
    // Reserve the slot before awaiting, so concurrent requests queue behind it.
    this.nextSlotAt = now + wait + SPACING_MS;
    win.sent++;
    windows[label] = win;
    await this.state.storage.put('windows', windows);
    if (wait) await this.deps.sleep(wait);
    const result = await this.deps.post(req.channel, req.text);
    if (result.ok) return 'posted';
    if (result.error === 'ratelimited') {
      this.nextSlotAt = this.deps.now() + (result.retryAfter ?? 1) * 1000;
      await this.defer(label, req, false);
      return 'summarised';
    }
    console.error('slack post failed', result.error);
    return 'failed';
  }

  private async defer(label: string, req: GateRequest, overLimit: boolean) {
    const pending = (await this.state.storage.get<Record<string, Pending>>('pending')) ?? {};
    const p = pending[label] ?? { count: 0, journey: req.journey, activity: req.activity, maxPerHour: req.maxPerHour, overLimit: false };
    p.count++;
    p.overLimit ||= overLimit;
    pending[label] = p;
    await this.state.storage.put('pending', pending);
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(this.deps.now() + SUMMARY_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    const channel = await this.state.storage.get<string>('channel');
    const pending = (await this.state.storage.get<Record<string, Pending>>('pending')) ?? {};
    const left: Record<string, Pending> = {};
    for (const [label, p] of Object.entries(pending)) {
      const result = channel ? await this.deps.post(channel, summaryText(p)) : { ok: false, error: 'no_channel' };
      if (!result.ok && result.error === 'ratelimited') left[label] = p;
      else if (!result.ok) console.error('slack summary failed', result.error);
    }
    if (Object.keys(left).length) {
      await this.state.storage.put('pending', left);
      await this.state.storage.setAlarm(this.deps.now() + SUMMARY_INTERVAL_MS);
    } else {
      await this.state.storage.delete('pending');
    }
  }
}
