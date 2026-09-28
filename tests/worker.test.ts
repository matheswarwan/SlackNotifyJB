import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyJwt } from '../src/worker/jwt.ts';
import { ChannelGate, MAX_WAIT_MS, SPACING_MS, SUMMARY_INTERVAL_MS, type GateRequest } from '../src/worker/gate.ts';
import { handle, planExecute, type Env } from '../src/worker/app.ts';
import { ARG } from '../src/shared/activity.ts';
import { encodeTemplate } from '../src/shared/template.ts';
import { MemoryStorage, SECRET, signJwt } from './helpers.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('verifyJwt accepts a good token and rejects tampering, wrong alg and expiry', async () => {
  const now = Date.now();
  const token = await signJwt({ a: 1, exp: now / 1000 + 60 });
  assert.equal((await verifyJwt(token, SECRET, now)).a, 1);
  const [h, , s] = token.split('.');
  const forged = `${h}.${Buffer.from('{"a":2}').toString('base64url')}.${s}`;
  await assert.rejects(verifyJwt(forged, SECRET, now), /Bad signature/);
  await assert.rejects(verifyJwt(token, 'other', now), /Bad signature/);
  await assert.rejects(verifyJwt(await signJwt({}, SECRET, 'none'), SECRET, now), /Unsupported/);
  await assert.rejects(verifyJwt(await signJwt({ exp: now / 1000 - 3600 }), SECRET, now), /expired/);
  await assert.rejects(verifyJwt(token, '', now), /not configured/);
  await assert.rejects(verifyJwt('not.a.jwt', SECRET, now), /Malformed/);
});

const req = (over: Partial<GateRequest> = {}): GateRequest =>
  ({ channel: 'C0123456789', text: 'hi', journey: 'J', activity: 'A', maxPerHour: 3, ...over });

function gateHarness() {
  let clock = 1_000_000;
  const posts: { channel: string; text: string }[] = [];
  const sleeps: number[] = [];
  const storage = new MemoryStorage();
  let reply: { ok: boolean; error?: string; retryAfter?: number } = { ok: true };
  const gate = new ChannelGate({ storage }, {}, {
    now: () => clock,
    sleep: async ms => { sleeps.push(ms); },
    post: async (channel, text) => { posts.push({ channel, text }); return reply; },
  });
  return { gate, posts, sleeps, storage, advance: (ms: number) => { clock += ms; }, setReply: (r: typeof reply) => { reply = r; } };
}

test('gate spaces messages about a second apart', async () => {
  const h = gateHarness();
  assert.deepEqual(await Promise.all([h.gate.send(req()), h.gate.send(req()), h.gate.send(req())]), ['posted', 'posted', 'posted']);
  assert.deepEqual(h.sleeps, [SPACING_MS, SPACING_MS * 2]);
});

test('gate caps per hour, then summarises on the alarm', async () => {
  const h = gateHarness();
  for (let i = 0; i < 3; i++) { await h.gate.send(req()); h.advance(2000); }
  assert.equal(await h.gate.send(req()), 'summarised');
  assert.equal(await h.gate.send(req({ activity: 'Other' })), 'posted', 'the cap is per activity');
  assert.equal(await h.gate.send(req()), 'summarised');
  assert.equal(h.storage.alarm, 1_000_000 + 3 * 2000 + SUMMARY_INTERVAL_MS);
  await h.gate.alarm();
  const summary = h.posts.at(-1)!;
  assert.match(summary.text, /…and 2 more contacts reached \*A\* in J/);
  assert.match(summary.text, /limit of 3 per hour/);
  assert.equal(h.storage.data.has('pending'), false);
  h.advance(60 * 60 * 1000);
  assert.equal(await h.gate.send(req()), 'posted', 'window resets after an hour');
});

test('gate summarises instead of queueing too long, and on Slack rate limits', async () => {
  const h = gateHarness();
  const many = Math.ceil(MAX_WAIT_MS / SPACING_MS) + 3;
  const outcomes = await Promise.all(Array.from({ length: many }, () => h.gate.send(req({ maxPerHour: 1000 }))));
  assert.ok(outcomes.includes('summarised'));
  assert.ok(Math.max(...h.sleeps) <= MAX_WAIT_MS);
  const h2 = gateHarness();
  h2.setReply({ ok: false, error: 'ratelimited', retryAfter: 30 });
  assert.equal(await h2.gate.send(req()), 'summarised');
  // Still rate limited when the alarm fires: keep the count and try later.
  await h2.gate.alarm();
  assert.equal((h2.storage.data.get('pending') as any)['J\u0000A'].count, 1);
  h2.setReply({ ok: true });
  await h2.gate.alarm();
  assert.match(h2.posts.at(-1)!.text, /faster than Slack accepts/);
  h2.setReply({ ok: false, error: 'ratelimited', retryAfter: 30 });
  assert.equal(await h2.gate.send(req({ activity: 'B' })), 'summarised', 'Retry-After is respected');
  h2.advance(31_000);
  h2.setReply({ ok: false, error: 'channel_not_found' });
  assert.equal(await h2.gate.send(req({ activity: 'B' })), 'failed');
});

test('planExecute renders values and built-ins from inArguments', () => {
  const plan = planExecute({
    keyValue: 'CK-1',
    inArguments: [
      { [ARG.channel]: 'C0123456789' }, { [ARG.template]: encodeTemplate('{{FirstName}} hit {{ActivityName}} ({{ContactKey}}) in {{JourneyName}}') },
      { [ARG.maxPerHour]: 10 }, { [ARG.journey]: 'Welcome' }, { [ARG.activity]: 'VIP' }, { [`${ARG.fieldPrefix}FirstName`]: 'Ana <3' },
    ],
  });
  assert.deepEqual(plan.request, { channel: 'C0123456789', text: 'Ana &lt;3 hit VIP (CK-1) in Welcome', journey: 'Welcome', activity: 'VIP', maxPerHour: 10 });
  assert.equal(planExecute({ inArguments: [] }).skipped, 'no_channel');
  assert.equal(planExecute({ inArguments: [{ [ARG.channel]: 'C0123456789' }, { [ARG.template]: '%%%' }] }).skipped, 'bad_template');
});

function env(over: Partial<Env> = {}) {
  const storage = new MemoryStorage();
  const gates = new Map<string, ChannelGate>();
  const e: Env = {
    ASSETS: { fetch: async (r: Request) => new URL(r.url).pathname === '/config.json'
      ? Response.json(JSON.parse(`{"arguments":{"execute":{"url":"x"}},"configurationArguments":{"applicationExtensionKey":"K","save":{"url":"x"},"publish":{"url":"x"},"validate":{"url":"x"},"stop":{"url":"x"},"unpublish":{"url":"x"}}}`))
      : new Response('asset') },
    GATE: {
      idFromName: (n: string) => n,
      get: (id: unknown) => {
        if (!gates.has(id as string)) gates.set(id as string, new ChannelGate({ storage }, e));
        return { fetch: (url: string, init: RequestInit) => gates.get(id as string)!.fetch(new Request(url, init)) };
      },
    },
    SLACK_BOT_TOKEN: 'xoxb-test', SLACK_API_BASE: 'https://slack.test/api', JWT_SIGNING_SECRET: SECRET,
    ...over,
  };
  return e;
}

test('config.json points every URL at this Worker and uses the extension key', async () => {
  const res = await handle(new Request('https://w.example/config.json'), env({ APPLICATION_EXTENSION_KEY: 'EXT' }));
  const c = await res.json() as any;
  assert.equal(c.arguments.execute.url, 'https://w.example/activity/execute');
  assert.equal(c.configurationArguments.publish.url, 'https://w.example/activity/publish');
  assert.equal(c.configurationArguments.applicationExtensionKey, 'EXT');
});

test('execute: verified JWT posts to Slack; bad JWT is rejected', async () => {
  const calls: { url: string; auth: string | null; body: any }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = new Request(input, init);
    calls.push({ url: r.url, auth: r.headers.get('authorization'), body: await r.json() });
    return Response.json({ ok: true });
  }) as typeof fetch;
  const body = await signJwt({ keyValue: 'CK', inArguments: [{ [ARG.channel]: 'C0123456789' }, { [ARG.template]: encodeTemplate('Hello {{ContactKey}}') }] });
  const e = env();
  const ok = await handle(new Request('https://w/activity/execute', { method: 'POST', body }), e);
  assert.deepEqual(await ok.json(), { status: 'posted' });
  assert.equal(calls[0].url, 'https://slack.test/api/chat.postMessage');
  assert.equal(calls[0].auth, 'Bearer xoxb-test');
  assert.deepEqual(calls[0].body, { channel: 'C0123456789', text: 'Hello CK', unfurl_links: false, unfurl_media: false });
  const bad = await handle(new Request('https://w/activity/execute', { method: 'POST', body: await signJwt({}, 'wrong') }), e);
  assert.equal(bad.status, 401);
  const skipped = await handle(new Request('https://w/activity/execute', { method: 'POST', body: await signJwt({ inArguments: [] }) }), e);
  assert.deepEqual(await skipped.json(), { status: 'skipped', reason: 'no_channel' });
  assert.equal(calls.length, 1);
});

test('lifecycle endpoints need a JWT; publish needs Slack configured', async () => {
  const body = await signJwt({ activityObjectID: 'x' });
  assert.equal((await handle(new Request('https://w/activity/save', { method: 'POST', body }), env())).status, 200);
  assert.equal((await handle(new Request('https://w/activity/save', { method: 'POST', body: 'x' }), env())).status, 401);
  assert.equal((await handle(new Request('https://w/activity/publish', { method: 'POST', body }), env({ SLACK_BOT_TOKEN: '' }))).status, 422);
  assert.equal((await handle(new Request('https://w/activity/execute'), env())).status, 405);
});

test('channel list requires channel listing to be set up and a confirmed SFMC user', async () => {
  const disabled = await handle(new Request('https://w/api/channels'), env());
  assert.equal(disabled.status, 503);
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = new Request(input, init); seen.push(r.url);
    if (r.url.includes('/v2/userinfo')) {
      return r.headers.get('authorization') === 'Bearer good' ? Response.json({ organization: { enterprise_id: 123 } }) : new Response('no', { status: 401 });
    }
    return Response.json({ ok: true, channels: [
      { id: 'C2', name: 'zeta', is_member: true }, { id: 'C1', name: 'alpha', is_member: true, is_private: true }, { id: 'C3', name: 'nope', is_member: false },
    ] });
  }) as typeof fetch;
  const e = env({ SFMC_SUBDOMAIN: 'mc0123456789abcdefghijklmnop', SFMC_ENTERPRISE_ID: '123' });
  assert.equal((await handle(new Request('https://w/api/channels', { headers: { authorization: 'Bearer bad' } }), e)).status, 401);
  const ok = await handle(new Request('https://w/api/channels', { headers: { authorization: 'Bearer good' } }), e);
  assert.deepEqual(await ok.json(), { channels: [{ id: 'C1', name: 'alpha', isPrivate: true }, { id: 'C2', name: 'zeta', isPrivate: false }] });
  assert.ok(seen[0].startsWith('https://mc0123456789abcdefghijklmnop.auth.marketingcloudapis.com/v2/userinfo'));
  const wrongOrg = await handle(new Request('https://w/api/channels', { headers: { authorization: 'Bearer other' } }), env({ SFMC_SUBDOMAIN: 'mc0123456789abcdefghijklmnop', SFMC_ENTERPRISE_ID: '999' }));
  assert.equal(wrongOrg.status, 401);
});
