import { discoverFields, loadConfig, object, saveActivity, validateConfig, type Discovery, type JsonObject, type NotifyConfig } from '../shared/activity';

export interface Transport {
  end?(): void;
  on(event: string, callback: (payload?: unknown) => void): void;
  off(event: string, callback: (payload?: unknown) => void): void;
  trigger(event: string, payload?: unknown): void;
}
export interface Channel { id: string; name: string; isPrivate: boolean }
export type ChannelList =
  | { state: 'loading' }
  | { state: 'ready'; channels: Channel[] }
  | { state: 'manual'; reason: string };
export type FetchChannels = (token: string) => Promise<Channel[]>;

export interface State {
  initialized: boolean;
  activity: JsonObject;
  config: NotifyConfig;
  discovery: Discovery;
  journeyName: string;
  channels: ChannelList;
  status: string;
  errors: Record<string, string>;
  saved: boolean;
}

export const fetchChannelsFromWorker: FetchChannels = async token => {
  const res = await fetch('./api/channels', { headers: { authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({})) as { channels?: Channel[]; error?: string };
  if (!res.ok || !data.channels) throw new Error(data.error || `HTTP ${res.status}`);
  return data.channels;
};

const MANUAL_REASONS: Record<string, string> = {
  channel_listing_disabled: 'Channel listing is not set up on the activity server.',
  unauthorized: 'Marketing Cloud did not confirm your session, so channels cannot be listed.',
  not_configured: 'The Slack bot token is not set on the activity server.',
};

export class ActivitySession {
  state: State = {
    initialized: false, activity: {}, config: loadConfig({}),
    discovery: { eventKey: '', fields: [], warnings: [] }, journeyName: '',
    channels: { state: 'loading' }, status: 'Waiting for Journey Builder…', errors: {}, saved: false,
  };
  private timer?: ReturnType<typeof setTimeout>;
  private handlers: [string, (payload?: unknown) => void][] = [];

  constructor(private bus: Transport, private notify: (state: State) => void,
    private fetchChannels: FetchChannels = fetchChannelsFromWorker, private timeout = 10000) {}

  get activityName(): string {
    const name = this.state.activity.name;
    return typeof name === 'string' && name ? name : 'Slack Notify';
  }

  private publish() {
    this.state = { ...this.state };
    this.notify(this.state);
    this.bus.trigger('updateButton', {
      button: 'next', text: 'done',
      enabled: this.state.initialized && !this.state.saved && !Object.keys(validateConfig(this.state.config, this.state.discovery)).length,
    });
  }

  start() {
    this.bind('initActivity', payload => {
      if (this.state.initialized) return;
      if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
        this.state.status = 'Journey Builder supplied an invalid activity.'; this.publish(); return;
      }
      this.state.activity = structuredClone(object(payload));
      this.state.config = loadConfig(this.state.activity);
      this.state.initialized = true;
      this.bus.trigger('updateButton', { button: 'back', visible: false });
      this.bus.trigger('requestTokens');
      this.bus.trigger('requestInteraction');
      this.requestFields();
    });
    this.bind('requestedTokens', payload => {
      const token = object(payload).fuel2token;
      if (typeof token !== 'string' || !token) { this.manual('No Marketing Cloud token was supplied.'); return; }
      this.fetchChannels(token).then(
        channels => { this.state.channels = { state: 'ready', channels }; this.publish(); },
        (e: Error) => this.manual(MANUAL_REASONS[e.message] ?? `Channels could not be loaded (${e.message}).`),
      );
    });
    this.bind('requestedInteraction', payload => {
      const name = object(payload).name;
      if (typeof name === 'string') { this.state.journeyName = name; this.publish(); }
    });
    this.bind('requestedTriggerEventDefinition', payload => {
      if (!this.state.initialized) return;
      clearTimeout(this.timer);
      this.state.discovery = discoverFields(payload);
      const n = this.state.discovery.fields.length;
      this.state.status = n ? `${n} Journey field${n === 1 ? '' : 's'} available` : 'Entry Event fields unavailable';
      this.state.errors = validateConfig(this.state.config, this.state.discovery);
      this.publish();
    });
    this.bind('clickedNext', () => this.done());
    this.bind('gotoStep', () => { this.bus.trigger('ready'); this.publish(); });
    this.timer = setTimeout(() => {
      this.state.status = 'No response from Journey Builder. Open this activity from a journey, or use the local demo.';
      this.publish();
    }, this.timeout);
    this.bus.trigger('ready');
  }

  private bind(name: string, fn: (payload?: unknown) => void) { this.handlers.push([name, fn]); this.bus.on(name, fn); }

  private manual(reason: string) { this.state.channels = { state: 'manual', reason }; this.publish(); }

  requestFields() {
    if (!this.state.initialized) return;
    clearTimeout(this.timer);
    this.state.status = 'Loading Entry Event fields…';
    this.publish();
    this.timer = setTimeout(() => {
      this.state.status = 'The Entry Event request timed out. Check the journey\'s Entry Source and try again.';
      this.publish();
    }, this.timeout);
    this.bus.trigger('requestTriggerEventDefinition');
  }

  update(patch: Partial<NotifyConfig>) {
    if (this.state.saved) return;
    this.state.config = { ...this.state.config, ...patch };
    this.state.errors = validateConfig(this.state.config, this.state.discovery);
    this.publish();
  }

  done() {
    if (this.state.saved) return;
    this.state.errors = validateConfig(this.state.config, this.state.discovery);
    if (!this.state.initialized || Object.keys(this.state.errors).length) { this.bus.trigger('ready'); this.publish(); return; }
    const payload = saveActivity(this.state.activity, this.state.config, this.state.discovery,
      { journeyName: this.state.journeyName, activityName: this.activityName });
    this.state.saved = true;
    this.state.status = 'Configuration sent to Journey Builder.';
    this.publish();
    this.bus.trigger('updateActivity', payload);
  }

  dispose() {
    clearTimeout(this.timer);
    for (const [name, fn] of this.handlers) this.bus.off(name, fn);
    this.handlers = [];
    this.bus.end?.();
  }
}
