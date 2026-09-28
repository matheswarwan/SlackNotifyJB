// Message templates use {{Name}} tokens. Names are Entry Event field paths
// (for example FirstName or Address.City) or one of the built-ins below.
export const BUILT_INS = ['JourneyName', 'ActivityName', 'ContactKey'] as const;
export const MAX_TEMPLATE_LENGTH = 3000;

const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;

export function tokens(template: string): string[] {
  return [...new Set([...template.matchAll(TOKEN)].map(m => m[1]))];
}

// Contact data must not be able to ping (<!channel>), link (<url|text>) or
// mention users, so Slack's control characters are escaped in values only.
// The template itself is written by the marketer and may use Slack mrkdwn.
export function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function render(template: string, values: Record<string, unknown>): string {
  return template.replace(TOKEN, (_, name: string) => {
    const value = values[name];
    return value === undefined || value === null ? '' : escapeSlack(String(value));
  });
}

// Journey Builder resolves {{...}} expressions anywhere in inArguments, so the
// template travels base64-encoded to keep its tokens away from that resolver.
export function encodeTemplate(template: string): string {
  const bytes = new TextEncoder().encode(template);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodeTemplate(encoded: string): string {
  const binary = atob(encoded);
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}
