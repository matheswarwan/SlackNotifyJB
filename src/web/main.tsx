import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import postmonger from 'postmonger';
import { validateConfig } from '../shared/activity';
import { BUILT_INS, MAX_TEMPLATE_LENGTH, render } from '../shared/template';
import { ActivitySession, type State } from './session';
import { DemoTransport, demoChannels } from './demo';
import '@salesforce-ux/design-system/assets/styles/salesforce-lightning-design-system.css';
import './styles.css';

const demo = window.self === window.top && new URLSearchParams(location.search).get('demo') === '1';

function ChannelPicker({ state, session }: { state: State; session: ActivitySession }) {
  const { config, channels, saved } = state;
  const error = state.errors.channel;
  const help = <p className="slds-form-element__help sn-help">
    The bot can only post to channels it has been invited to. In Slack, type <code>/invite @your-bot</code> in the channel.
  </p>;
  if (channels.state === 'loading') return <p role="status">Loading Slack channels…</p>;
  if (channels.state === 'ready') {
    const listed = channels.channels.some(c => c.id === config.channelId);
    return <div className={`slds-form-element${error ? ' slds-has-error' : ''}`}>
      <label className="slds-form-element__label" htmlFor="channel"><abbr className="slds-required" title="required">* </abbr>Channel</label>
      <div className="slds-form-element__control"><div className="slds-select_container">
        <select className="slds-select" id="channel" disabled={saved} value={config.channelId} aria-invalid={!!error}
          onChange={e => session.update({ channelId: e.target.value, channelName: channels.channels.find(c => c.id === e.target.value)?.name ?? '' })}>
          <option value="">Select a channel</option>
          {config.channelId && !listed && <option value={config.channelId}>{config.channelName ? `#${config.channelName}` : config.channelId} (bot not in channel)</option>}
          {channels.channels.map(c => <option key={c.id} value={c.id}>{c.isPrivate ? '🔒 ' : '#'}{c.name}</option>)}
        </select>
      </div></div>
      {error && <p className="slds-form-element__help" role="alert">{error}</p>}
      {!channels.channels.length && <p className="slds-form-element__help">The bot is not in any channels yet.</p>}
      {help}
    </div>;
  }
  return <div className={`slds-form-element${error ? ' slds-has-error' : ''}`}>
    <p className="slds-text-color_weak slds-m-bottom_x-small">{channels.reason} Enter the channel ID instead.</p>
    <label className="slds-form-element__label" htmlFor="channel"><abbr className="slds-required" title="required">* </abbr>Channel ID</label>
    <div className="slds-form-element__control">
      <input className="slds-input" id="channel" disabled={saved} value={config.channelId} placeholder="C0123456789" aria-invalid={!!error}
        onChange={e => session.update({ channelId: e.target.value.trim().toUpperCase(), channelName: '' })} />
    </div>
    {error && <p className="slds-form-element__help" role="alert">{error}</p>}
    <p className="slds-form-element__help sn-help">In Slack, open the channel name, then About. The ID is at the bottom.</p>
    {help}
  </div>;
}

function MessageEditor({ state, session }: { state: State; session: ActivitySession }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { config, discovery, saved } = state;
  const error = state.errors.template;
  const insert = (name: string) => {
    const el = ref.current, token = `{{${name}}}`;
    const start = el?.selectionStart ?? config.template.length, end = el?.selectionEnd ?? start;
    session.update({ template: config.template.slice(0, start) + token + config.template.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length); });
  };
  const sample: Record<string, string> = {
    JourneyName: state.journeyName || 'Your journey', ActivityName: session.activityName, ContactKey: '0031x00000AbCdE',
  };
  for (const f of discovery.fields) sample[f.path] = `‹${f.path}›`;
  return <>
    <div className={`slds-form-element${error ? ' slds-has-error' : ''}`}>
      <label className="slds-form-element__label" htmlFor="template"><abbr className="slds-required" title="required">* </abbr>Message</label>
      <div className="slds-form-element__control">
        <textarea ref={ref} className="slds-textarea sn-template" id="template" rows={4} maxLength={MAX_TEMPLATE_LENGTH} disabled={saved}
          value={config.template} aria-invalid={!!error} onChange={e => session.update({ template: e.target.value })} />
      </div>
      {error && <p className="slds-form-element__help" role="alert">{error}</p>}
      <p className="slds-form-element__help sn-help">Slack formatting works: <code>*bold*</code>, <code>_italic_</code>, <code>&lt;https://example.com|a link&gt;</code>.</p>
    </div>
    <div className="slds-m-top_small">
      <p className="slds-text-title slds-m-bottom_xx-small">Insert a field</p>
      <div className="sn-chips">
        {BUILT_INS.map(name => <button type="button" key={name} className="slds-button slds-button_neutral sn-chip" disabled={saved} onClick={() => insert(name)}>{name}</button>)}
        {discovery.fields.map(f => <button type="button" key={f.path} className="slds-button slds-button_outline-brand sn-chip" disabled={saved} title={f.type} onClick={() => insert(f.path)}>{f.path}</button>)}
      </div>
      <div className="sn-source slds-m-top_x-small">
        <p className="slds-text-color_weak" role="status">{state.status}</p>
        <button type="button" className="slds-button" disabled={!state.initialized || saved} onClick={() => session.requestFields()}>Refresh fields</button>
      </div>
      {discovery.warnings.map(w => <p key={w} className="slds-text-color_weak">{w}</p>)}
    </div>
    <div className="slds-box slds-theme_shade slds-m-top_medium">
      <p className="slds-text-title slds-m-bottom_xx-small">Preview</p>
      <p className="sn-preview">{render(config.template, sample) || <span className="slds-text-color_weak">Empty message</span>}</p>
    </div>
  </>;
}

function App() {
  const [state, setState] = useState<State>();
  const [session, setSession] = useState<ActivitySession>();
  useEffect(() => {
    const controller = demo
      ? new ActivitySession(new DemoTransport(), setState, demoChannels)
      : new ActivitySession(new postmonger.Session(), setState);
    setSession(controller); setState(controller.state); controller.start();
    return () => controller.dispose();
  }, []);
  if (!state || !session) return <main className="sn-shell slds-p-around_large" role="status">Loading…</main>;
  const valid = state.initialized && !Object.keys(validateConfig(state.config, state.discovery)).length;
  const maxError = state.errors.maxPerHour;
  return <main className="sn-shell slds-p-around_medium">
    <header className="slds-page-header">
      <p className="slds-text-title_caps slds-m-bottom_x-small">Slack Notify</p>
      <h1 className="slds-page-header__title">Post to Slack when a contact reaches this step</h1>
    </header>
    {demo && <aside className="slds-notify slds-notify_alert slds-theme_warning slds-m-top_medium sn-notice">Local demo: journey data and channels are made up. Done saves in this browser.</aside>}
    <section className="slds-card slds-m-top_medium" aria-labelledby="channel-heading">
      <div className="slds-card__header"><h2 className="slds-card__header-title" id="channel-heading">1. Channel</h2></div>
      <div className="slds-card__body slds-card__body_inner"><ChannelPicker state={state} session={session} /></div>
    </section>
    <section className="slds-card slds-m-top_medium" aria-labelledby="message-heading">
      <div className="slds-card__header"><h2 className="slds-card__header-title" id="message-heading">2. Message</h2></div>
      <div className="slds-card__body slds-card__body_inner"><MessageEditor state={state} session={session} /></div>
    </section>
    <section className="slds-card slds-m-top_medium" aria-labelledby="volume-heading">
      <div className="slds-card__header"><h2 className="slds-card__header-title" id="volume-heading">3. Volume</h2></div>
      <div className="slds-card__body slds-card__body_inner">
        <div className={`slds-form-element sn-narrow${maxError ? ' slds-has-error' : ''}`}>
          <label className="slds-form-element__label" htmlFor="max">Individual messages per hour</label>
          <div className="slds-form-element__control">
            <input className="slds-input" id="max" type="number" min={1} max={1000} step={1} disabled={state.saved} value={state.config.maxPerHour}
              aria-invalid={!!maxError} onChange={e => session.update({ maxPerHour: Number(e.target.value) })} />
          </div>
          {maxError && <p className="slds-form-element__help" role="alert">{maxError}</p>}
        </div>
        <p className="slds-form-element__help sn-help">After this many messages in an hour, further contacts are counted and posted as one summary every 5 minutes. Contacts always continue through the journey.</p>
      </div>
    </section>
    <footer className="sn-footer slds-m-top_medium">
      <span role="status">{state.saved ? (demo ? 'Saved in this browser. Reload to reopen.' : 'Saved. Save the journey to keep it.') : ''}</span>
      <button className="slds-button slds-button_brand" disabled={!valid || state.saved} onClick={() => session.done()}>Done</button>
    </footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
