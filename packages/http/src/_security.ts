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

// Local type alias avoids importing the full axios type surface here.
// The helper is intentionally axios-agnostic at the type level so the
// (de-facto small) request surface stays decoupled.
interface AxiosLike {
  request<T = any>(config: any): Promise<{ status: number; headers: Record<string, any>; data: T }>;
}

/**
 * HTTP statuses where the server expects the client to re-issue the
 * request against the URL in the `Location` header.
 */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Issue an HTTP request that re-validates every redirect hop.
 *
 * axios's default `maxRedirects: 5` would otherwise let an
 * attacker-controlled tool/manual endpoint 302 the client into
 * `http://169.254.169.254/...` (cloud metadata) or any internal HTTP
 * service, and the response body would be handed back to the caller.
 * Mirrors the Python helper added in utcp-http 1.1.4. Backs
 * GHSA-9qhg-99ww-9mqc.
 *
 * Behaviour:
 *   - Calls `ensureSecureUrl(url, context)` on the initial URL.
 *   - Forces `maxRedirects: 0` so axios returns 3xx responses rather
 *     than following them silently.
 *   - On a 3xx with a `Location` header, resolves the target against
 *     the current URL and runs `ensureSecureUrl` on it before
 *     issuing the next hop. Rejection raises immediately.
 *   - Caps the chain at `maxHops` (default 5).
 *   - Mirrors RFC 7231 method semantics: 303 forces GET and drops
 *     the request body; other 3xx statuses preserve method and body.
 *
 * @typeParam T - Expected response body type.
 */
export async function safeRequestWithRedirects<T = any>(
  axiosInstance: AxiosLike,
  config: { url: string; method: string; data?: any; [key: string]: any },
  context: string,
  maxHops: number = 5,
): Promise<{ status: number; headers: Record<string, any>; data: T }> {
  ensureSecureUrl(config.url, context);

  let currentUrl = config.url;
  let currentMethod = config.method;
  let currentData = config.data;
  let hops = 0;

  while (true) {
    const response = await axiosInstance.request<T>({
      ...config,
      url: currentUrl,
      method: currentMethod,
      data: currentData,
      // Take redirect control away from axios so it cannot
      // silently land on an unvalidated host.
      maxRedirects: 0,
      // Treat 3xx as a "real" response so axios does not throw and
      // we can inspect the Location header ourselves.
      validateStatus: (status: number) => status < 400,
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers['location'] ?? response.headers['Location'];
    if (!location || typeof location !== 'string') {
      // 3xx without a usable Location header -- nothing to follow,
      // hand the response back to the caller as-is.
      return response;
    }

    if (hops >= maxHops) {
      throw new Error(
        `Too many redirects (>${maxHops}) during ${context} starting from ${JSON.stringify(config.url)}.`,
      );
    }

    const nextUrl = new URL(location, currentUrl).toString();
    ensureSecureUrl(nextUrl, `${context} (redirect target)`);

    if (response.status === 303) {
      currentMethod = 'GET';
      currentData = undefined;
    }
    currentUrl = nextUrl;
    hops += 1;
  }
}
