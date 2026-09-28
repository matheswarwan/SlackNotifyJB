import { BUILT_INS, MAX_TEMPLATE_LENGTH, encodeTemplate, tokens } from './template';

export type JsonObject = Record<string, unknown>;
export const object = (v: unknown): JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as JsonObject : {};

// App-owned configuration, stored at metaData.slackNotify. Journey Builder does
// not send metaData to execute, so everything the runtime needs is also written
// to inArguments by saveActivity.
export interface NotifyConfig {
  version: 1;
  channelId: string;
  channelName: string;
  template: string;
  maxPerHour: number;
}

export const DEFAULT_MAX_PER_HOUR = 60;
export const DEFAULT_TEMPLATE = '{{ContactKey}} reached *{{ActivityName}}* in {{JourneyName}}';

// inArgument keys owned by this activity. Each is its own flat object, which
// is the shape Journey Builder documents for inArguments.
export const ARG = {
  channel: 'slackChannel',
  template: 'slackTemplate',
  maxPerHour: 'slackMaxPerHour',
  journey: 'slackJourney',
  activity: 'slackActivity',
  fieldPrefix: 'slackField:',
} as const;

const owned = (key: string) =>
  key === ARG.channel || key === ARG.template || key === ARG.maxPerHour ||
  key === ARG.journey || key === ARG.activity || key.startsWith(ARG.fieldPrefix);

export interface JourneyField { path: string; type: string; expression: string }
export interface Discovery { eventKey: string; fields: JourneyField[]; warnings: string[] }

const segment = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// Postmonger's requestedTriggerEventDefinition payload has no guaranteed field
// schema, so this reads the places where one has been seen and nothing else.
export function discoverFields(value: unknown): Discovery {
  const event = object(value);
  const key = typeof event.eventDefinitionKey === 'string' ? event.eventDefinitionKey
    : typeof event.key === 'string' ? event.key : '';
  const result: Discovery = { eventKey: key, fields: [], warnings: [] };
  if (!value) result.warnings.push('Journey Builder returned no Entry Event. Select an Entry Source and reopen this activity.');
  if (!key || !segment.test(key)) {
    result.warnings.push('No Entry Event key is available, so Journey fields cannot be used in the message.');
    return result;
  }
  const seen = new WeakSet<object>();
  const paths = new Set<string>();
  function walk(node: unknown, path: string[], depth: number) {
    if (depth > 20 || node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const field = object(item);
        const name = field.name ?? field.Name;
        if (typeof name === 'string') walk(field, [...path, name], depth + 1);
      }
      return;
    }
    const schema = object(node);
    const type = String(schema.type ?? schema.fieldType ?? schema.FieldType ?? 'Unknown');
    if (type.toLowerCase() === 'array' || schema.items) return;
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [name, child] of Object.entries(object(schema.properties))) walk(child, [...path, name], depth + 1);
      return;
    }
    const children = schema.fields ?? schema.Fields;
    if (children) { walk(children, path, depth + 1); return; }
    if (!path.length || type.toLowerCase() === 'object' || !path.every(p => segment.test(p))) return;
    const name = path.join('.');
    if (!paths.has(name)) {
      result.fields.push({ path: name, type, expression: `{{Event.${key}.${name}}}` });
      paths.add(name);
    }
  }
  walk(event.schema, [], 0);
  walk(event.fields ?? event.Fields, [], 0);
  const de = object(event.dataExtension);
  walk(de.fields ?? de.Fields, [], 0);
  if (!result.fields.length) result.warnings.push('Journey Builder supplied no Entry Event fields. You can still use the built-in tokens.');
  return result;
}

export function loadConfig(activity: JsonObject): NotifyConfig {
  const saved = object(object(activity.metaData).slackNotify);
  const max = Number(saved.maxPerHour);
  return {
    version: 1,
    channelId: typeof saved.channelId === 'string' ? saved.channelId : '',
    channelName: typeof saved.channelName === 'string' ? saved.channelName : '',
    template: typeof saved.template === 'string' ? saved.template : DEFAULT_TEMPLATE,
    maxPerHour: Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_PER_HOUR,
  };
}

export const CHANNEL_ID = /^[CG][A-Z0-9]{8,}$/;

export function validateConfig(config: NotifyConfig, discovery: Discovery): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!CHANNEL_ID.test(config.channelId)) errors.channel = 'Choose a channel, or enter a channel ID such as C0123456789.';
  const template = config.template.trim();
  if (!template) errors.template = 'Write the message to send.';
  else if (config.template.length > MAX_TEMPLATE_LENGTH) errors.template = `Keep the message under ${MAX_TEMPLATE_LENGTH} characters.`;
  else {
    const known = new Set<string>([...BUILT_INS, ...discovery.fields.map(f => f.path)]);
    const unknown = tokens(config.template).filter(t => !known.has(t));
    if (unknown.length) errors.template = `Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`;
  }
  if (!Number.isInteger(config.maxPerHour) || config.maxPerHour < 1 || config.maxPerHour > 1000) {
    errors.maxPerHour = 'Use a whole number from 1 to 1000.';
  }
  return errors;
}

export interface SaveContext { journeyName: string; activityName: string }

export function saveActivity(activity: JsonObject, config: NotifyConfig, discovery: Discovery, context: SaveContext): JsonObject {
  const errors = validateConfig(config, discovery);
  if (Object.keys(errors).length) throw new Error(Object.values(errors).join(' '));
  const copy = structuredClone(activity);
  const args = object(copy.arguments), execute = object(args.execute);
  // Keep inArguments that belong to someone else, including foreign keys that
  // share an object with one of ours.
  const previous = Array.isArray(execute.inArguments) ? execute.inArguments : [];
  const retained = previous
    .map(arg => Object.fromEntries(Object.entries(object(arg)).filter(([key]) => !owned(key))))
    .filter(arg => Object.keys(arg).length);
  const used = new Set(tokens(config.template));
  const fields = discovery.fields.filter(f => used.has(f.path)).map(f => ({ [ARG.fieldPrefix + f.path]: f.expression }));
  const mine = [
    { [ARG.channel]: config.channelId },
    { [ARG.template]: encodeTemplate(config.template) },
    { [ARG.maxPerHour]: config.maxPerHour },
    { [ARG.journey]: context.journeyName },
    { [ARG.activity]: context.activityName },
    ...fields,
  ];
  copy.arguments = { ...args, execute: { ...execute, inArguments: [...retained, ...mine] } };
  copy.metaData = { ...object(copy.metaData), isConfigured: true, slackNotify: structuredClone(config) };
  return copy;
}
