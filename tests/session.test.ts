import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivitySession, type State } from '../src/web/session.ts';
import { ARG } from '../src/shared/activity.ts';
import { Bus, entryEvent } from './helpers.ts';

const tick = () => new Promise(r => setImmediate(r));

test('full lifecycle: init, tokens, channels, fields, Done once', async () => {
  const bus = new Bus();
  let state!: State;
  const tokensSeen: string[] = [];
  const session = new ActivitySession(bus, s => { state = s; }, async t => { tokensSeen.push(t); return [{ id: 'C0123456789', name: 'alerts', isPrivate: false }]; });
  session.start();
  assert.equal(bus.events[0][0], 'ready');
  bus.emit('initActivity', { name: 'VIP alert', arguments: { execute: { url: 'keep' } } });
  for (const e of ['requestTokens', 'requestInteraction', 'requestTriggerEventDefinition']) assert.ok(bus.events.some(x => x[0] === e), e);
  bus.emit('requestedTokens', { fuel2token: 'tok' });
  bus.emit('requestedInteraction', { name: 'Welcome Journey' });
  bus.emit('requestedTriggerEventDefinition', entryEvent);
  await tick();
  assert.deepEqual(tokensSeen, ['tok']);
  assert.equal(state.channels.state, 'ready');
  assert.equal((bus.last('updateButton') as any).enabled, false, 'no channel yet');
  session.update({ channelId: 'C0123456789', channelName: 'alerts', template: 'Hi {{FirstName}}' });
  assert.equal((bus.last('updateButton') as any).enabled, true);
  bus.emit('clickedNext');
  bus.emit('clickedNext');
  const updates = bus.events.filter(e => e[0] === 'updateActivity');
  assert.equal(updates.length, 1);
  const flat = Object.assign({}, ...(updates[0][1] as any).arguments.execute.inArguments);
  assert.equal(flat[ARG.journey], 'Welcome Journey');
  assert.equal(flat[ARG.activity], 'VIP alert');
  session.dispose();
  assert.equal(bus.handlers.size, 0);
});

test('channel list failure falls back to manual entry with a reason', async () => {
  const bus = new Bus();
  let state!: State;
  const session = new ActivitySession(bus, s => { state = s; }, async () => { throw new Error('channel_listing_disabled'); });
  session.start();
  bus.emit('initActivity', {});
  bus.emit('requestedTokens', { fuel2token: 'tok' });
  await tick();
  assert.equal(state.channels.state, 'manual');
  assert.match((state.channels as any).reason, /not set up/);
  bus.emit('requestedTokens', {});
  assert.match((state.channels as any).reason, /No Marketing Cloud token/);
  session.dispose();
});

test('invalid Done does not save; saved config is restored on reopen', async () => {
  const bus = new Bus();
  const session = new ActivitySession(bus, () => {}, async () => []);
  session.start();
  bus.emit('initActivity', { metaData: { slackNotify: { channelId: 'G0123456789', channelName: 'vip', template: '{{ContactKey}}', maxPerHour: 5 } } });
  assert.equal(session.state.config.maxPerHour, 5);
  session.update({ template: '{{Unknown}}' });
  bus.emit('clickedNext');
  assert.equal(bus.events.filter(e => e[0] === 'updateActivity').length, 0);
  assert.ok(session.state.errors.template);
  session.dispose();
});
