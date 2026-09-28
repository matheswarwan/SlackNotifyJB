import type { GateStorage } from '../src/worker/gate.ts';

export const SECRET = 'test-signing-secret';

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export async function signJwt(payload: object, secret = SECRET, alg = 'HS256'): Promise<string> {
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg, typ: 'JWT' })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

export class MemoryStorage implements GateStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string) { return structuredClone(this.data.get(key)) as T | undefined; }
  async put<T>(key: string, value: T) { this.data.set(key, structuredClone(value)); }
  async delete(key: string) { return this.data.delete(key); }
  async getAlarm() { return this.alarm; }
  async setAlarm(time: number) { this.alarm = time; }
}

export class Bus {
  events: [string, unknown][] = [];
  handlers = new Map<string, (p?: unknown) => void>();
  on(n: string, f: (p?: unknown) => void) { this.handlers.set(n, f); }
  off(n: string) { this.handlers.delete(n); }
  trigger(n: string, p?: unknown) { this.events.push([n, p]); }
  emit(n: string, p?: unknown) { this.handlers.get(n)?.(p); }
  last(n: string) { return this.events.filter(e => e[0] === n).at(-1)?.[1]; }
}

export const entryEvent = { key: 'ENTRY-1', schema: { fields: [
  { name: 'FirstName', type: 'Text' }, { name: 'Email', type: 'EmailAddress' },
  { name: 'Address', type: 'Object', fields: [{ name: 'City', type: 'Text' }] },
] } };
