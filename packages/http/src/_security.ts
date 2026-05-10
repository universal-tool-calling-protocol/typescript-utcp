/**
 * URL validation shared by every HTTP-based communication protocol.
 *
 * Centralised so all three HTTP protocols (http, streamable_http, sse) enforce
 * the same trust boundary at every network edge — manual discovery AND tool
 * invocation. Issue universal-tool-calling-protocol/python-utcp#83
 * (GHSA-39j6-4867-gg4w / CVE-2026-44661) was caused by the runtime invocation
 * path forgetting the discovery-time check, so this module also provides an
 * explicit `ensureSecureUrl` to call before every outbound HTTP request.
 *
 * Mirrors `utcp_http._security` from the Python reference implementation.
 */

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
]);

function tryParseUrl(url: string): URL | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function getHostname(parsed: URL): string {
  // Different URL implementations disagree about whether `URL.hostname`
  // includes the surrounding brackets for IPv6 literals — Bun keeps them
  // (`[::1]`), Node's WHATWG URL strips them (`::1`). Normalise both forms
  // so the loopback set match works either way.
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  return host;
}

/**
 * Returns true if `url` is safe to fetch from a UTCP HTTP protocol.
 *
 * Allowed:
 *   - Any `https://` URL.
 *   - `http://` URLs whose host is exactly `localhost`, `127.0.0.1`, or `::1`.
 *
 * Rejected:
 *   - Plain `http://` to any other host (MITM exposure).
 *   - URLs whose hostname *starts* with `localhost` / `127.0.0.1` but isn't
 *     actually loopback (e.g. `http://localhost.evil.com`,
 *     `http://127.0.0.1.attacker.example`). The earlier `startsWith` check
 *     let these through.
 *   - Anything without a scheme/host (file://, javascript:, etc.).
 */
export function isSecureUrl(url: string): boolean {
  const parsed = tryParseUrl(url);
  if (!parsed) return false;

  const scheme = parsed.protocol.toLowerCase();
  const host = getHostname(parsed);
  if (!host) return false;

  if (scheme === 'https:') return true;

  if (scheme === 'http:') {
    return LOOPBACK_HOSTNAMES.has(host);
  }

  return false;
}

/**
 * Returns true if `url`'s host is a literal loopback address.
 *
 * Used by the OpenAPI converter to detect the SSRF case where a remote spec
 * declares `servers: [{ url: "http://127.0.0.1:..." }]` to redirect tool
 * invocation at the host running the agent. Hostname-based — not a string
 * prefix — so `http://localhost.evil.com` returns false.
 */
export function isLoopbackUrl(url: string): boolean {
  const parsed = tryParseUrl(url);
  if (!parsed) return false;

  const host = getHostname(parsed);
  if (!host) return false;

  return LOOPBACK_HOSTNAMES.has(host);
}

/**
 * Throw an Error if `url` is not safe to fetch.
 *
 * `context` is a short label (`"manual discovery"`, `"tool invocation"`,
 * etc.) included in the error so log readers can tell which trust boundary
 * was breached.
 */
export function ensureSecureUrl(url: string, context?: string): void {
  if (isSecureUrl(url)) return;

  const where = context ? ` during ${context}` : '';
  throw new Error(
    `Security error${where}: URL must use HTTPS or be a literal loopback ` +
      `address (localhost / 127.0.0.1 / ::1). Got: ${JSON.stringify(url)}. ` +
      'Plain HTTP to any other host is rejected to prevent MITM attacks ' +
      'and SSRF into internal services.',
  );
}
