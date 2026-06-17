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
 * Return true if `host` is an IP literal that the local kernel will
 * route to the host running the agent.
 *
 * Mirrors `utcp_http._security._ip_is_loopback_like` from the Python
 * reference implementation. Goes beyond the obvious `127.0.0.1` /
 * `::1` literals to cover:
 *   - the entire `127.0.0.0/8` range (the WHATWG URL parser normalizes
 *     shorthand forms like `http://127.1/` and `http://2130706433/`
 *     into canonical dotted-quad, but `127.0.0.2` is a distinct host
 *     that still routes to local loopback);
 *   - `0.0.0.0` and `::` -- on Linux a TCP connect to these lands on
 *     local loopback;
 *   - IPv4-mapped IPv6 loopback (`::ffff:127.0.0.1` etc.) -- the
 *     dual-stack socket layer routes these to the v4 loopback even
 *     though strict IPv6 semantics do not call them loopback.
 *
 * Closes the residual SSRF window left by the original
 * `LOOPBACK_HOSTNAMES` set in `isLoopbackUrl`, which is used by the
 * OpenAPI converter to block remote specs declaring loopback
 * `servers[0].url` values.
 */
function isIpLoopbackLike(host: string): boolean {
  if (host === '0.0.0.0' || host === '::') return true;
  // IPv4 dotted-quad: any 127.x.x.x is loopback (entire 127.0.0.0/8).
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map((s) => parseInt(s, 10));
    if (octets.every((o) => o >= 0 && o <= 255)) {
      if (octets[0] === 127) return true;
    }
  }
  // IPv6 literals (URL.hostname already strips brackets in our caller).
  // The WHATWG URL parser canonicalises:
  //   ::1 -> ::1
  //   0:0:0:0:0:0:0:1 -> ::1
  //   ::ffff:127.0.0.1 -> ::ffff:7f00:1
  //   ::ffff:0:1 -> ::ffff:0:1
  // Match the canonical loopback IPv6 (already in the set) and any
  // IPv4-mapped form that embeds a 127.x.x.x address.
  if (host === '::1' || host === '::') return true;
  // IPv4-mapped IPv6: ::ffff:<v4>. The canonical compressed form is
  // ::ffff:HHHH:HHHH where the trailing 32 bits encode the v4.
  // Detect any `::ffff:` prefix and inspect the trailing 4 hex groups
  // (or dotted-quad fallback).
  if (host.startsWith('::ffff:')) {
    const tail = host.slice('::ffff:'.length);
    // Dotted-quad tail: ::ffff:127.0.0.1
    const tailV4 = tail.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (tailV4) {
      const oct = tailV4.slice(1).map((s) => parseInt(s, 10));
      if (oct.every((o) => o >= 0 && o <= 255) && oct[0] === 127) return true;
    }
    // Hex-pair tail: ::ffff:7f00:1 (== 127.0.0.1). Parse two 16-bit
    // groups and reassemble as a /8 check.
    const tailHex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (tailHex) {
      const hi = parseInt(tailHex[1], 16);
      const lo = parseInt(tailHex[2], 16);
      // hi covers octets 1+2 of the v4 address; check whether octet 1
      // (the upper 8 bits of hi) is 127.
      const octet1 = (hi >>> 8) & 0xff;
      if (octet1 === 127) return true;
      // Guard against unused-var lint.
      void lo;
    }
  }
  return false;
}

/**
 * Returns true if `url`'s host is a literal loopback address.
 *
 * Used by the OpenAPI converter to detect the SSRF case where a remote spec
 * declares `servers: [{ url: "http://127.0.0.1:..." }]` to redirect tool
 * invocation at the host running the agent. Hostname-based — not a string
 * prefix — so `http://localhost.evil.com` returns false. Also covers
 * `127.0.0.0/8`, `0.0.0.0`, `::`, and IPv4-mapped IPv6 loopback forms.
 */
export function isLoopbackUrl(url: string): boolean {
  const parsed = tryParseUrl(url);
  if (!parsed) return false;

  const host = getHostname(parsed);
  if (!host) return false;

  if (LOOPBACK_HOSTNAMES.has(host)) return true;
  return isIpLoopbackLike(host);
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
 * Headers that carry authentication / session material and must be
 * stripped when a redirect crosses to a different origin. Matches the
 * canonical behaviour of fetch / requests / curl. Comparison is
 * case-insensitive against this lowercase set.
 */
const AUTH_SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  // Canonical IETF headers.
  'authorization',
  'proxy-authorization',
  'cookie',
  'www-authenticate',
  // Hyphenated API-key / service-token names.
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-amz-security-token',
  'x-goog-api-key',
  // Underscore-separated variants (some HTTP stacks normalise
  // `X-API-Key` to `X_API_KEY`).
  'x_api_key',
  'api_key',
  'x_auth_token',
  'x_access_token',
  'x_csrf_token',
  'x_xsrf_token',
  // Condensed / no-separator variants seen in custom APIs
  // (`XApiKey` lowercased becomes `xapikey`).
  'apikey',
  'xapikey',
  'authtoken',
  'xauthtoken',
  'accesstoken',
  'xaccesstoken',
  'bearertoken',
  'sessionid',
  'csrftoken',
  'xsrftoken',
]);

/**
 * Catches ad-hoc auth header names that aren't in the explicit set
 * above (`X-MyApp-Token`, `Custom-Bearer`, `X_MyApp_Token`, etc.).
 * Conservative but biased toward strip-on-cross-origin since false
 * positives are only a usability cost.
 *
 * Two alternations:
 *   1. Word-boundary match (hyphen / underscore / start / end) so
 *      `X-Foo-Token` and `X_FOO_TOKEN` both trip.
 *   2. No-boundary match on compound condensed names (`XApiKey`
 *      lowercased to `xapikey`).
 */
const AUTH_HEADER_REGEX = /(?:(?:^|[-_])(?:auth|authn|authz|token|key|secret|bearer|session|sid|api[-_]?key|jwt|csrf|xsrf)(?:[-_]|$))|(?:apikey|authtoken|accesstoken|bearertoken|sessionid|csrftoken|xsrftoken|xapikey|xauthtoken|xaccesstoken|xapitoken)/i;

function headerIsAuthSensitive(name: string): boolean {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  if (AUTH_SENSITIVE_HEADERS.has(lower)) return true;
  return AUTH_HEADER_REGEX.test(lower);
}

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
};

function effectivePort(u: URL): string {
  return u.port || DEFAULT_PORTS[u.protocol.toLowerCase()] || '';
}

function sameOrigin(a: string, b: string): boolean {
  let ua: URL, ub: URL;
  try {
    ua = new URL(a);
    ub = new URL(b);
  } catch {
    return false;
  }
  if (ua.protocol.toLowerCase() !== ub.protocol.toLowerCase()) return false;
  if (ua.hostname.toLowerCase() !== ub.hostname.toLowerCase()) return false;
  // Normalise default ports (`""` vs `"443"`) so a same-origin redirect
  // to an explicit-port URL doesn't trip the cross-origin scrub and
  // silently strip the caller's auth.
  return effectivePort(ua) === effectivePort(ub);
}

/**
 * Mutate `config` in place to drop credential-bearing fields when the
 * next hop crosses to a different origin. Mirrors browser / requests
 * behaviour:
 *   - `Authorization` and other canonical auth headers;
 *   - common API-key / service-token header names + an auth-regex
 *     catch-all for ad-hoc names;
 *   - axios basic-`auth`;
 *   - `params` (commonly carries API keys via the query string);
 *   - `withCredentials`;
 *   - the request body (`data`) -- a 307/308 redirect preserves the
 *     body, and the body of e.g. an OAuth2 token POST contains the
 *     exact credentials we're trying to protect. Refuse to resend it
 *     cross-origin.
 */
function scrubCrossOriginCredentials(config: Record<string, any>): void {
  const headers = config.headers;
  if (headers && typeof headers === 'object') {
    const scrubbed: Record<string, any> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (headerIsAuthSensitive(k)) continue;
      scrubbed[k] = v;
    }
    config.headers = scrubbed;
  }
  delete config.auth;
  delete config.params;
  delete config.withCredentials;
  // Request body. 307/308 would otherwise resend it to the new origin
  // -- the OAuth token-POST case is the headline exploit.
  delete config.data;
}

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

  // Build a mutable working copy so we can strip credentials between
  // hops without mutating the caller's object. ``headers`` is shallow-
  // copied because we may need to rewrite it during cross-origin
  // scrubbing; other fields are kept by reference (good enough for the
  // primitive / plain-object values we use).
  const working: Record<string, any> = { ...config };
  if (working.headers && typeof working.headers === 'object') {
    working.headers = { ...working.headers };
  }

  let currentUrl = working.url;
  let hops = 0;

  while (true) {
    const response = await axiosInstance.request<T>({
      ...working,
      url: currentUrl,
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

    // Strip credential-bearing fields when the redirect crosses to a
    // different origin. Mirrors fetch / requests / curl: without this
    // an attacker-controlled endpoint could 302 us to their own
    // server and our ``Authorization`` header / basic ``auth`` /
    // ``params`` API key would be forwarded along.
    if (!sameOrigin(currentUrl, nextUrl)) {
      scrubCrossOriginCredentials(working);
    }

    if (response.status === 303) {
      working.method = 'GET';
      working.data = undefined;
    }
    currentUrl = nextUrl;
    hops += 1;
  }
}
