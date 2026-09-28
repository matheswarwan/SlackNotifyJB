import { ARG, CHANNEL_ID, object } from '../shared/activity';
import { decodeTemplate, render } from '../shared/template';
import type { GateOutcome, GateRequest } from './gate';
import { JwtError, verifyJwt } from './jwt';
import { listChannels, type SlackEnv } from './slack';
import { sfmcCheckEnabled, verifySfmcUser, type SfmcEnv } from './sfmc';

interface Fetcher { fetch(request: Request): Promise<Response> }
interface GateStub { fetch(url: string, init: RequestInit): Promise<Response> }
interface GateNamespace { idFromName(name: string): unknown; get(id: unknown): GateStub }

export interface Env extends SlackEnv, SfmcEnv {
  ASSETS: Fetcher;
  GATE: GateNamespace;
  JWT_SIGNING_SECRET?: string;
  APPLICATION_EXTENSION_KEY?: string;
}

const LIFECYCLE = ['save', 'publish', 'validate', 'stop', 'unpublish'] as const;
const noStore = { 'cache-control': 'no-store' };

async function activityConfig(url: URL, env: Env): Promise<Response> {
  const template = await env.ASSETS.fetch(new Request(new URL('/config.json', url), { method: 'GET' }));
  if (!template.ok) return new Response('Configuration template unavailable', { status: 503 });
  const config = await template.json() as {
    arguments: { execute: { url: string } };
    configurationArguments: Record<string, { url?: string } | string>;
  };
  config.arguments.execute.url = `${url.origin}/activity/execute`;
  for (const action of LIFECYCLE) (config.configurationArguments[action] as { url: string }).url = `${url.origin}/activity/${action}`;
  if (env.APPLICATION_EXTENSION_KEY) config.configurationArguments.applicationExtensionKey = env.APPLICATION_EXTENSION_KEY;
  return Response.json(config, { headers: noStore });
}

async function channels(request: Request, env: Env): Promise<Response> {
  if (!sfmcCheckEnabled(env)) return Response.json({ error: 'channel_listing_disabled' }, { status: 503, headers: noStore });
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!await verifySfmcUser(env, token)) return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
  try {
    return Response.json({ channels: await listChannels(env) }, { headers: noStore });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502, headers: noStore });
  }
}

export interface ExecutePlan { request?: GateRequest; skipped?: string }

// Turns a verified execute payload into the message to send.
export function planExecute(payload: Record<string, unknown>): ExecutePlan {
  const args: Record<string, unknown> = {};
  for (const arg of Array.isArray(payload.inArguments) ? payload.inArguments : []) Object.assign(args, object(arg));
  const channel = String(args[ARG.channel] ?? '');
  if (!CHANNEL_ID.test(channel)) return { skipped: 'no_channel' };
  let template: string;
  try { template = decodeTemplate(String(args[ARG.template] ?? '')); } catch { return { skipped: 'bad_template' }; }
  if (!template.trim()) return { skipped: 'no_template' };
  const journey = String(args[ARG.journey] ?? '');
  const activity = String(args[ARG.activity] ?? '');
  const values: Record<string, unknown> = { JourneyName: journey, ActivityName: activity, ContactKey: payload.keyValue ?? '' };
  for (const [key, value] of Object.entries(args)) if (key.startsWith(ARG.fieldPrefix)) values[key.slice(ARG.fieldPrefix.length)] = value;
  const max = Number(args[ARG.maxPerHour]);
  return { request: { channel, text: render(template, values), journey, activity, maxPerHour: Number.isInteger(max) && max > 0 ? max : 60 } };
}

async function verified(request: Request, env: Env): Promise<Record<string, unknown> | Response> {
  try {
    return await verifyJwt(await request.text(), env.JWT_SIGNING_SECRET ?? '');
  } catch (e) {
    if (e instanceof JwtError) return Response.json({ error: 'invalid_jwt' }, { status: 401 });
    throw e;
  }
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/config.json') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    return activityConfig(url, env);
  }
  if (url.pathname === '/health') {
    return Response.json({
      status: 'ok',
      slackConfigured: !!env.SLACK_BOT_TOKEN,
      jwtConfigured: !!env.JWT_SIGNING_SECRET,
      packageConfigured: !!env.APPLICATION_EXTENSION_KEY,
      channelListing: sfmcCheckEnabled(env),
    }, { headers: noStore });
  }
  if (url.pathname === '/api/channels') {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    return channels(request, env);
  }
  if (url.pathname.startsWith('/activity/')) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
    const action = url.pathname.slice('/activity/'.length);
    if (action === 'execute') {
      const payload = await verified(request, env);
      if (payload instanceof Response) return payload;
      const plan = planExecute(payload);
      // Always 200 once the request is authentic: a Slack problem should never
      // hold a contact up in the journey.
      if (!plan.request) {
        console.error('execute skipped', plan.skipped);
        return Response.json({ status: 'skipped', reason: plan.skipped });
      }
      const gate = env.GATE.get(env.GATE.idFromName(plan.request.channel));
      const res = await gate.fetch('https://gate/send', { method: 'POST', body: JSON.stringify(plan.request) });
      const { outcome } = await res.json() as { outcome: GateOutcome };
      return Response.json({ status: outcome });
    }
    if ((LIFECYCLE as readonly string[]).includes(action)) {
      const payload = await verified(request, env);
      if (payload instanceof Response) return payload;
      if ((action === 'publish' || action === 'validate') && !env.SLACK_BOT_TOKEN) {
        return Response.json({ error: 'Slack is not configured on the activity server.' }, { status: 422 });
      }
      return Response.json({});
    }
    return new Response('Not found', { status: 404 });
  }
  return env.ASSETS.fetch(request);
}
