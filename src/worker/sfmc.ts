// The config UI asks Journey Builder for the signed-in user's token
// (Postmonger requestTokens) and sends it with the channel-list request. The
// Worker checks it against the tenant's userinfo endpoint so Slack channel
// names are only shown to people signed in to this Marketing Cloud account.
export interface SfmcEnv { SFMC_SUBDOMAIN?: string; SFMC_ENTERPRISE_ID?: string }

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, number>();

async function digest(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const sfmcCheckEnabled = (env: SfmcEnv) => /^[a-z0-9]{20,40}$/.test(env.SFMC_SUBDOMAIN ?? '');

export async function verifySfmcUser(env: SfmcEnv, token: string, now = Date.now()): Promise<boolean> {
  if (!sfmcCheckEnabled(env) || !token) return false;
  const key = await digest(token);
  const expires = cache.get(key);
  if (expires && expires > now) return true;
  const res = await fetch(`https://${env.SFMC_SUBDOMAIN}.auth.marketingcloudapis.com/v2/userinfo`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  if (env.SFMC_ENTERPRISE_ID) {
    const info = await res.json().catch(() => ({})) as { organization?: { enterprise_id?: number | string } };
    if (String(info.organization?.enterprise_id ?? '') !== env.SFMC_ENTERPRISE_ID) return false;
  }
  if (cache.size > 1000) cache.clear();
  cache.set(key, now + TTL_MS);
  return true;
}
