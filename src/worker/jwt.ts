// Journey Builder signs activity requests with the installed package's JWT
// signing secret (HS256) when config.json sets useJwt. The request body is the
// bare token.
const LEEWAY_SECONDS = 300;

function base64UrlDecode(part: string): Uint8Array {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

export class JwtError extends Error {}

export async function verifyJwt(token: string, secret: string, now = Date.now()): Promise<Record<string, unknown>> {
  if (!secret) throw new JwtError('JWT signing secret is not configured');
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new JwtError('Malformed token');
  const [head, body, sig] = parts;
  let header: { alg?: string }, payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(head)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  } catch {
    throw new JwtError('Malformed token');
  }
  if (header.alg !== 'HS256') throw new JwtError('Unsupported algorithm');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, base64UrlDecode(sig), new TextEncoder().encode(`${head}.${body}`));
  if (!ok) throw new JwtError('Bad signature');
  const seconds = now / 1000;
  if (typeof payload.exp === 'number' && payload.exp + LEEWAY_SECONDS < seconds) throw new JwtError('Token expired');
  if (typeof payload.nbf === 'number' && payload.nbf - LEEWAY_SECONDS > seconds) throw new JwtError('Token not yet valid');
  return payload;
}
