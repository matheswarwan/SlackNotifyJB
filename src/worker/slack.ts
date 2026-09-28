export interface SlackEnv { SLACK_BOT_TOKEN?: string; SLACK_API_BASE?: string }

export interface PostResult { ok: boolean; error?: string; retryAfter?: number }

const base = (env: SlackEnv) => env.SLACK_API_BASE || 'https://slack.com/api';

export async function postMessage(env: SlackEnv, channel: string, text: string): Promise<PostResult> {
  if (!env.SLACK_BOT_TOKEN) return { ok: false, error: 'not_configured' };
  const res = await fetch(`${base(env)}/chat.postMessage`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
  });
  if (res.status === 429) return { ok: false, error: 'ratelimited', retryAfter: Number(res.headers.get('retry-after')) || 1 };
  const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
  return data.ok ? { ok: true } : { ok: false, error: data.error || `http_${res.status}` };
}

export interface Channel { id: string; name: string; isPrivate: boolean }

// Only channels the bot has been invited to, because it can post nowhere else.
export async function listChannels(env: SlackEnv, maxPages = 10): Promise<Channel[]> {
  if (!env.SLACK_BOT_TOKEN) throw new Error('not_configured');
  const channels: Channel[] = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ types: 'public_channel,private_channel', exclude_archived: 'true', limit: '1000' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${base(env)}/conversations.list?${params}`, { headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}` } });
    const data = await res.json().catch(() => ({})) as {
      ok?: boolean; error?: string;
      channels?: { id: string; name: string; is_private?: boolean; is_member?: boolean }[];
      response_metadata?: { next_cursor?: string };
    };
    if (!data.ok) throw new Error(data.error || `http_${res.status}`);
    for (const c of data.channels ?? []) if (c.is_member) channels.push({ id: c.id, name: c.name, isPrivate: !!c.is_private });
    cursor = data.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}
