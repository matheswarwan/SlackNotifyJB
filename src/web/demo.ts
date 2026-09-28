import type { Channel, Transport } from './session';

// Local demo (?demo=1 outside an iframe): synthetic journey data, and Done
// saves to localStorage so reopening can be tested.
const STORAGE_KEY = 'slack-notify-demo';

export const demoEvent = {
  key: 'DEMO-ENTRY', schema: { fields: [
    { name: 'SubscriberKey', type: 'Text' }, { name: 'EmailAddress', type: 'EmailAddress' },
    { name: 'FirstName', type: 'Text' }, { name: 'Tier', type: 'Text' }, { name: 'OrderAmount', type: 'Decimal' },
  ] },
};

export const demoChannels = async (): Promise<Channel[]> => [
  { id: 'C0DEMO00001', name: 'marketing-alerts', isPrivate: false },
  { id: 'G0DEMO00002', name: 'vip-desk', isPrivate: true },
];

export class DemoTransport implements Transport {
  private listeners = new Map<string, Set<(payload?: unknown) => void>>();
  private initialized = false;
  on(name: string, callback: (payload?: unknown) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(callback);
  }
  off(name: string, callback: (payload?: unknown) => void) { this.listeners.get(name)?.delete(callback); }
  trigger(name: string, payload?: unknown) {
    if (name === 'ready' && !this.initialized) {
      this.initialized = true;
      let activity = { name: 'VIP alert' };
      try { activity = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? activity; } catch { /* corrupt demo storage */ }
      queueMicrotask(() => this.emit('initActivity', activity));
    }
    if (name === 'requestTokens') queueMicrotask(() => this.emit('requestedTokens', { fuel2token: 'demo' }));
    if (name === 'requestInteraction') queueMicrotask(() => this.emit('requestedInteraction', { name: 'Welcome Journey' }));
    if (name === 'requestTriggerEventDefinition') queueMicrotask(() => this.emit('requestedTriggerEventDefinition', demoEvent));
    if (name === 'updateActivity') {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch { /* storage blocked */ }
    }
  }
  private emit(name: string, payload: unknown) { this.listeners.get(name)?.forEach(fn => fn(payload)); }
}
