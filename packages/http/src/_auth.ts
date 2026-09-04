// packages/http/src/_auth.ts
//
// Authentication helpers shared by the fetch-based SSE and Streamable HTTP
// protocols, so a security fix (token URL validation, cache keying, header
// injection checks) lands in one place.
import { Auth, ApiKeyAuth, BasicAuth, OAuth2Auth, OAuth2UserAuth } from '@utcp/sdk';
import { ensureSecureUrl, assertNoCrlf } from './_security';

export interface AuthLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface BasicCredentials {
  username: string;
  password: string;
}

export type OAuthTokenCache = Map<string, { access_token: string; expires_at?: number }>;

/**
 * Apply a call template's auth to the request: API keys go to a header, the
 * query string or a cookie; Basic credentials are returned for the caller to
 * encode; a user-provisioned OAuth2 token goes to its header. OAuth2 client
 * credentials are handled separately (async) by finalizeAuthHeaders.
 */
export function applyAuth(
  auth: Auth | undefined,
  headers: Record<string, string>,
  queryParams: Record<string, any>,
  log: AuthLogger,
): { auth?: BasicCredentials; cookies: Record<string, string> } {
  let basic: BasicCredentials | undefined;
  const cookies: Record<string, string> = {};

  if (auth) {
    if ('api_key' in auth) {
      const apiKeyAuth = auth as ApiKeyAuth;
      if (apiKeyAuth.api_key) {
        assertNoCrlf(apiKeyAuth.var_name, 'ApiKeyAuth.var_name');
        // Default to 'header' if location is not specified
        const location = apiKeyAuth.location || 'header';
        if (location === 'header') {
          headers[apiKeyAuth.var_name] = apiKeyAuth.api_key;
        } else if (location === 'query') {
          queryParams[apiKeyAuth.var_name] = apiKeyAuth.api_key;
        } else if (location === 'cookie') {
          cookies[apiKeyAuth.var_name] = apiKeyAuth.api_key;
        }
      } else {
        log.error('API key not found for ApiKeyAuth.');
        throw new Error('API key for ApiKeyAuth not found.');
      }
    } else if ('username' in auth && 'password' in auth) {
      const basicAuth = auth as BasicAuth;
      basic = { username: basicAuth.username, password: basicAuth.password };
    } else if ('token_url' in auth) {
      // OAuth2 client credentials are fetched asynchronously later.
    } else if (auth.auth_type === 'oauth2_user') {
      // Interactive (user-delegated) OAuth2: token provisioned out-of-band.
      const userAuth = auth as OAuth2UserAuth;
      if (!userAuth.access_token) {
        throw new Error(
          "access_token for oauth2_user auth is empty. Run an interactive " +
            "login to provision it.",
        );
      }
      const headerName = userAuth.var_name || 'Authorization';
      const prefix = userAuth.prefix ?? 'Bearer ';
      assertNoCrlf(headerName, 'OAuth2UserAuth.var_name');
      assertNoCrlf(prefix, 'OAuth2UserAuth.prefix');
      assertNoCrlf(userAuth.access_token, 'OAuth2UserAuth.access_token');
      headers[headerName] = `${prefix}${userAuth.access_token}`;
    }
  }

  return { auth: basic, cookies };
}

/**
 * Apply Basic auth, cookies and (if configured) an OAuth2 client-credentials
 * bearer token to the request headers. The token fetch runs under `signal`.
 */
export async function finalizeAuthHeaders(
  auth: Auth | undefined,
  headers: Record<string, string>,
  basic: BasicCredentials | undefined,
  cookies: Record<string, string>,
  signal: AbortSignal,
  tokenCache: OAuthTokenCache,
  log: AuthLogger,
): Promise<void> {
  if (basic) {
    const credentials = Buffer.from(`${basic.username}:${basic.password}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  if (Object.keys(cookies).length > 0) {
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    assertNoCrlf(cookieHeader, 'Cookie');
    headers['Cookie'] = headers['Cookie'] ? `${headers['Cookie']}; ${cookieHeader}` : cookieHeader;
  }

  if (auth && 'token_url' in auth) {
    const token = await fetchOAuth2Token(auth as OAuth2Auth, signal, tokenCache, log);
    headers['Authorization'] = `Bearer ${token}`;
  }
}

/**
 * OAuth2 client-credentials flow: credentials in the body first, then as a
 * Basic Auth header. Tokens are cached per full OAuth configuration (token
 * URL, client id, secret, scope), never per client_id alone: two templates
 * may share a client_id but point at different issuers. Both credential
 * methods run under the caller's `signal`, which carries the call's own
 * deadline, so the whole token flow can never exceed it.
 */
export async function fetchOAuth2Token(
  authDetails: OAuth2Auth,
  signal: AbortSignal,
  tokenCache: OAuthTokenCache,
  log: AuthLogger,
): Promise<string> {
  const clientId = authDetails.client_id;

  // The token URL may come from an untrusted call template; validate it
  // before the cache is consulted, so a template with a rejected URL never
  // receives a token fetched on behalf of another (GHSA-8cp3-qxj6-px34).
  ensureSecureUrl(authDetails.token_url, 'OAuth2 token URL');

  const cacheKey = JSON.stringify([authDetails.token_url, clientId, authDetails.client_secret, authDetails.scope || '']);
  const cached = tokenCache.get(cacheKey);
  if (cached && (cached.expires_at === undefined || cached.expires_at > Date.now())) {
    return cached.access_token;
  }

  const storeToken = (tokenData: any): string => {
    if (!tokenData || !tokenData.access_token) {
      throw new Error('Access token not found in response.');
    }
    const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
    tokenCache.set(cacheKey, { access_token: tokenData.access_token, expires_at: Date.now() + expiresIn * 1000 });
    return tokenData.access_token;
  };

  const requestToken = async (headers: Record<string, string>, form: Record<string, string>): Promise<string> => {
    if (signal.aborted) {
      throw new Error('Timed out before the token request could start.');
    }
    const response = await fetch(authDetails.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return storeToken(await response.json());
  };

  // Method 1: credentials in the request body
  try {
    log.info(`Attempting OAuth2 token fetch for '${clientId}' with credentials in body.`);
    return await requestToken({}, {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: authDetails.client_secret,
      scope: authDetails.scope || '',
    });
  } catch (error: any) {
    log.error(`OAuth2 with credentials in body failed for '${clientId}': ${error.message}. Trying Basic Auth header.`);
  }

  // Method 2: credentials as a Basic Auth header
  try {
    log.info(`Attempting OAuth2 token fetch for '${clientId}' with Basic Auth header.`);
    const credentials = Buffer.from(`${clientId}:${authDetails.client_secret}`).toString('base64');
    return await requestToken({ 'Authorization': `Basic ${credentials}` }, {
      grant_type: 'client_credentials',
      scope: authDetails.scope || '',
    });
  } catch (error: any) {
    log.error(`OAuth2 with Basic Auth header also failed for '${clientId}': ${error.message}`);
    throw new Error(`Failed to fetch OAuth2 token for client '${clientId}' after trying all methods. Details: ${error.message}`);
  }
}
