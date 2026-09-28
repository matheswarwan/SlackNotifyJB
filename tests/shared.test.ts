import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTemplate, encodeTemplate, render, tokens } from '../src/shared/template.ts';
import { ARG, discoverFields, loadConfig, saveActivity, validateConfig, type NotifyConfig } from '../src/shared/activity.ts';
import { entryEvent } from './helpers.ts';

test('tokens are found once each, with or without inner spaces', () => {
  assert.deepEqual(tokens('Hi {{FirstName}} {{ FirstName }} from {{Address.City}}'), ['FirstName', 'Address.City']);
});

test('render escapes contact values but not the template', () => {
  const out = render('*New:* {{Name}} <https://x.test|open>', { Name: '<!channel> & <https://evil|click>' });
  assert.equal(out, '*New:* &lt;!channel&gt; &amp; &lt;https://evil|click&gt; <https://x.test|open>');
  assert.equal(render('{{Missing}}|{{Zero}}', { Zero: 0 }), '|0');
});

test('template encoding round-trips Unicode and hides tokens', () => {
  const t = 'Olá {{FirstName}} 🎉 — ☃';
  const enc = encodeTemplate(t);
  assert.ok(!enc.includes('{{'));
  assert.equal(decodeTemplate(enc), t);
});

test('discoverFields builds Event bindings including nested objects', () => {
  const d = discoverFields(entryEvent);
  assert.deepEqual(d.fields.map(f => f.path), ['FirstName', 'Email', 'Address.City']);
  assert.equal(d.fields[2].expression, '{{Event.ENTRY-1.Address.City}}');
  assert.equal(discoverFields(null).fields.length, 0);
});

const good: NotifyConfig = { version: 1, channelId: 'C0123456789', channelName: 'alerts', template: 'VIP {{FirstName}} ({{ContactKey}})', maxPerHour: 30 };

test('validateConfig flags channel, unknown fields and limits', () => {
  const d = discoverFields(entryEvent);
  assert.deepEqual(validateConfig(good, d), {});
  const bad = validateConfig({ ...good, channelId: 'general', template: '{{Nope}} {{Other}}', maxPerHour: 0 }, d);
  assert.match(bad.channel, /channel ID/);
  assert.equal(bad.template, 'Unknown fields: Nope, Other.');
  assert.ok(bad.maxPerHour);
  assert.match(validateConfig({ ...good, template: '   ' }, d).template, /Write/);
});

test('saveActivity writes flat inArguments, keeps foreign ones, and reloads', () => {
  const d = discoverFields(entryEvent);
  const activity = {
    name: 'VIP alert', key: 'k',
    arguments: { execute: { url: 'keep', inArguments: [{ other: 'x', [ARG.channel]: 'COLD' }, { [`${ARG.fieldPrefix}Old`]: 'y' }] } },
    metaData: { icon: 'icon.png' },
  };
  const saved = saveActivity(activity, good, d, { journeyName: 'Welcome', activityName: 'VIP alert' }) as any;
  const args: Record<string, unknown>[] = saved.arguments.execute.inArguments;
  assert.equal(saved.arguments.execute.url, 'keep');
  assert.deepEqual(args[0], { other: 'x' });
  assert.ok(args.every(a => Object.keys(a).length === 1 || a.other), 'each owned argument is its own object');
  const flat = Object.assign({}, ...args);
  assert.equal(flat[ARG.channel], 'C0123456789');
  assert.equal(flat[`${ARG.fieldPrefix}FirstName`], '{{Event.ENTRY-1.FirstName}}');
  assert.equal(flat[`${ARG.fieldPrefix}Email`], undefined, 'unused fields are not sent');
  assert.equal(flat[`${ARG.fieldPrefix}Old`], undefined, 'stale owned fields are removed');
  assert.equal(decodeTemplate(flat[ARG.template]), good.template);
  assert.equal(saved.metaData.icon, 'icon.png');
  assert.equal(saved.metaData.isConfigured, true);
  assert.deepEqual(loadConfig(saved), good);
  assert.deepEqual(activity.arguments.execute.inArguments[0], { other: 'x', [ARG.channel]: 'COLD' }, 'input not mutated');
  assert.throws(() => saveActivity(activity, { ...good, channelId: '' }, d, { journeyName: '', activityName: '' }));
});
