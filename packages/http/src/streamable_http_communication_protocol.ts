/**
 * Streamable HTTP Communication Protocol for UTCP.
 *
 * Handles HTTP streaming with chunked transfer encoding for real-time data.
 */
// packages/http/src/streamable_http_communication_protocol.ts
import { CommunicationProtocol } from '@utcp/sdk';
import { RegisterManualResult } from '@utcp/sdk';
import { CallTemplate } from '@utcp/sdk';
import { UtcpManual, UtcpManualSerializer } from '@utcp/sdk';
import { ApiKeyAuth } from '@utcp/sdk';
import { BasicAuth } from '@utcp/sdk';
import { OAuth2Auth } from '@utcp/sdk';
import { OAuth2UserAuth } from '@utcp/sdk';
import { IUtcpClient } from '@utcp/sdk';
import { StreamableHttpCallTemplate, StreamableHttpCallTemplateSchema } from './streamable_http_call_template';
import { ensureSecureUrl, assertNoCrlf } from './_security';
import { truncateByCodePoint } from './_text';
import { buildUrlWithPathParams } from './_url';

/**
 * REQUIRED
 * Streamable HTTP communication protocol implementation for UTCP client.
 *
 * Handles HTTP streaming with chunked transfer encoding for real-time data.
 *
 * Chunks are yielded according to the response Content-Type:
 *   - application/x-ndjson: one parsed JSON value per line (raw line on parse error)
 *   - application/json: the whole body buffered and parsed as a single JSON value
 *   - application/octet-stream and anything else: Buffer chunks of at most chunk_size bytes
 */
export class StreamableHttpCommunicationProtocol implements CommunicationProtocol {
  private oauthTokens: Map<string, { access_token: string; expires_at?: number }> = new Map();

  private _logInfo(message: string): void {
    console.log(`[StreamableHttpCommunicationProtocol] ${message}`);
  }

  private _logError(message: string): void {
    console.error(`[StreamableHttpCommunicationProtocol] ${message}`);
  }

  private _applyAuth(
    provider: StreamableHttpCallTemplate,
    headers: Record<string, string>,
    queryParams: Record<string, any>
  ): { auth?: { username: string; password: string }; cookies: Record<string, string> } {
    let auth: { username: string; password: string } | undefined;
    const cookies: Record<string, string> = {};

    if (provider.auth) {
      if ('api_key' in provider.auth) {
        const apiKeyAuth = provider.auth as ApiKeyAuth;
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
          this._logError('API key not found for ApiKeyAuth.');
          throw new Error('API key for ApiKeyAuth not found.');
        }
      } else if ('username' in provider.auth && 'password' in provider.auth) {
        const basicAuth = provider.auth as BasicAuth;
        auth = { username: basicAuth.username, password: basicAuth.password };
      } else if ('token_url' in provider.auth) {
        // OAuth2 will be handled separately
      } else if (provider.auth.auth_type === 'oauth2_user') {
        // Interactive (user-delegated) OAuth2: token provisioned out-of-band.
        const userAuth = provider.auth as OAuth2UserAuth;
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

    return { auth, cookies };
  }

  /**
   * Applies Basic auth, cookies and (if configured) an OAuth2 client-credentials
   * bearer token to the request headers.
   */
  private async _finalizeAuthHeaders(
    provider: StreamableHttpCallTemplate,
    headers: Record<string, string>,
    auth: { username: string; password: string } | undefined,
    cookies: Record<string, string>,
    signal: AbortSignal,
  ): Promise<void> {
    if (auth) {
      const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    if (Object.keys(cookies).length > 0) {
      const cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      assertNoCrlf(cookieHeader, 'Cookie');
      headers['Cookie'] = headers['Cookie'] ? `${headers['Cookie']}; ${cookieHeader}` : cookieHeader;
    }

    if (provider.auth && 'token_url' in provider.auth) {
      const token = await this._handleOAuth2(provider.auth as OAuth2Auth, signal);
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  /**
   * REQUIRED
   * Register a manual and its tools from a StreamableHttp provider.
   */
  async registerManual(
    caller: IUtcpClient,
    manualCallTemplate: CallTemplate
  ): Promise<RegisterManualResult> {
    if ((manualCallTemplate as any).call_template_type !== 'streamable_http') {
      throw new Error('StreamableHttpCommunicationProtocol can only be used with StreamableHttpCallTemplate');
    }

    const provider = StreamableHttpCallTemplateSchema.parse(manualCallTemplate);
    const url = provider.url;

    // Security check: only HTTPS or loopback HTTP allowed for manual discovery.
    ensureSecureUrl(url, 'manual discovery');

    this._logInfo(`Discovering tools from '${provider.name}' (HTTP Stream) at ${url}`);

    // One deadline for the whole discovery call, token fetch included.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), provider.timeout || 60000);
    try {
      const requestHeaders: Record<string, string> = provider.headers ? { ...provider.headers } : {};
      const queryParams: Record<string, any> = {};
      const { auth, cookies } = this._applyAuth(provider, requestHeaders, queryParams);
      await this._finalizeAuthHeaders(provider, requestHeaders, auth, cookies, controller.signal);

      // Build URL with query parameters
      const urlObj = new URL(url);
      Object.entries(queryParams).forEach(([key, value]) => {
        urlObj.searchParams.append(key, String(value));
      });

      // ``redirect: 'error'`` refuses to follow 3xx responses -- streaming
      // handshakes shouldn't redirect, and doing so silently would let an
      // attacker-controlled endpoint steer the stream into an internal
      // service (GHSA-9qhg-99ww-9mqc).
      try {
        const response = await fetch(urlObj.toString(), {
          method: provider.http_method || 'GET',
          headers: requestHeaders,
          redirect: 'error',
          signal: controller.signal,
        });

        if (!response.ok) {
          // Read the body before throwing: servers put the real reason there
          // (e.g. { "error": "..." }); discarding it leaves callers with only a
          // status code. Fall back to statusText when the body is empty.
          const body = await response.text().catch(() => '');
          // Truncate like the streaming path does, so a huge error page does
          // not land in errors[] and logs in full. By code point, so a
          // multi-byte character on the boundary cannot leave a lone surrogate.
          const detail = truncateByCodePoint(body.trim(), 200) || response.statusText;
          throw new Error(`HTTP ${response.status}: ${detail}`);
        }

        const responseText = await response.text();
        const utcpManual = new UtcpManualSerializer().validateDict(JSON.parse(responseText));

        this._logInfo(`Discovered ${utcpManual.tools.length} tools from '${provider.name}'`);

        return {
          manualCallTemplate: provider,
          manual: utcpManual,
          success: true,
          errors: [],
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (error: any) {
      clearTimeout(timer);
      this._logError(`Error discovering tools from '${provider.name}': ${error.message}`);
      return {
        manualCallTemplate: provider,
        manual: new UtcpManualSerializer().validateDict({ tools: [] }),
        success: false,
        errors: [error.message || String(error)],
      };
    }
  }

  /**
   * REQUIRED
   * Deregister a manual (no-op for HTTP streaming).
   */
  async deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void> {
    // No-op for HTTP streaming
  }

  /**
   * REQUIRED
   * Call a tool using HTTP (non-streaming).
   *
   * Collects every chunk produced by callToolStreaming. Binary chunks are
   * concatenated into a single Buffer; parsed (JSON / NDJSON) chunks are
   * returned as an array, mirroring the Python implementation.
   */
  async callTool(
    caller: IUtcpClient,
    toolName: string,
    toolArgs: Record<string, any>,
    toolCallTemplate: CallTemplate
  ): Promise<any> {
    const binaryChunks: Buffer[] = [];
    const parsedChunks: any[] = [];
    for await (const chunk of this.callToolStreaming(caller, toolName, toolArgs, toolCallTemplate)) {
      if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
        binaryChunks.push(Buffer.from(chunk));
      } else {
        parsedChunks.push(chunk);
      }
    }
    if (binaryChunks.length > 0) {
      return Buffer.concat(binaryChunks);
    }
    return parsedChunks;
  }

  /**
   * REQUIRED
   * Call a tool using HTTP streaming.
   * Returns an async generator that yields chunks of data.
   */
  async *callToolStreaming(
    caller: IUtcpClient,
    toolName: string,
    toolArgs: Record<string, any>,
    toolCallTemplate: CallTemplate
  ): AsyncGenerator<any, void, unknown> {
    if ((toolCallTemplate as any).call_template_type !== 'streamable_http') {
      throw new Error('StreamableHttpCommunicationProtocol can only be used with StreamableHttpCallTemplate');
    }
    const provider = StreamableHttpCallTemplateSchema.parse(toolCallTemplate);

    const requestHeaders: Record<string, string> = provider.headers ? { ...provider.headers } : {};
    let bodyContent: any = undefined;
    const remainingArgs: Record<string, any> = { ...toolArgs };

    if (provider.header_fields) {
      for (const fieldName of provider.header_fields) {
        if (fieldName in remainingArgs) {
          assertNoCrlf(fieldName, 'header field name');
          const value = String(remainingArgs[fieldName]);
          assertNoCrlf(value, `header field '${fieldName}'`);
          requestHeaders[fieldName] = value;
          delete remainingArgs[fieldName];
        }
      }
    }

    // "Supplied" means the caller passed the field, whatever its value; a
    // field already mapped to a header above is no longer in remainingArgs.
    const bodyFieldSupplied = !!provider.body_field && provider.body_field in remainingArgs;
    if (provider.body_field && bodyFieldSupplied) {
      bodyContent = remainingArgs[provider.body_field];
      delete remainingArgs[provider.body_field];
    }

    if (bodyFieldSupplied && (provider.http_method || 'GET').toUpperCase() === 'GET') {
      // fetch() rejects a GET with a body before anything reaches the server;
      // surface the misconfiguration as a clear error instead.
      throw new Error(
        `Tool '${toolName}': body_field '${provider.body_field}' was supplied but http_method is GET, ` +
        `which cannot carry a request body. Set http_method to POST.`
      );
    }

    // Build the URL with path parameters substituted
    const url = this._buildUrlWithPathParams(provider.url, remainingArgs);

    // Security check: re-validate the resolved URL before each invocation.
    ensureSecureUrl(url, 'tool invocation');

    // The rest of the arguments are query parameters
    const queryParams: Record<string, any> = { ...remainingArgs };

    // Handle authentication
    const { auth, cookies } = this._applyAuth(provider, requestHeaders, queryParams);

    // One deadline for the whole call: token fetch, request and stream.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), provider.timeout || 60000);
    // Everything from here on runs under the deadline, and the single
    // finally below clears the timer on every exit path, including a throw
    // while building the URL or serializing the body.
    try {
      await this._finalizeAuthHeaders(provider, requestHeaders, auth, cookies, controller.signal);

      const urlObj = new URL(url);
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        urlObj.searchParams.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      });

      let body: BodyInit | undefined = undefined;
      if (bodyContent !== undefined) {
        const hasContentType = Object.keys(requestHeaders).some(h => h.toLowerCase() === 'content-type');
        if (!hasContentType) {
          requestHeaders['Content-Type'] = provider.content_type;
        }
        const contentType = Object.entries(requestHeaders).find(([h]) => h.toLowerCase() === 'content-type')?.[1] || '';
        if (contentType.includes('application/json')) {
          body = JSON.stringify(bodyContent);
        } else if (typeof bodyContent === 'string' || bodyContent instanceof Uint8Array || bodyContent instanceof ArrayBuffer) {
          body = bodyContent as BodyInit;
        } else {
          body = JSON.stringify(bodyContent);
        }
      }

      this._logInfo(`Executing streaming HTTP tool '${toolName}' with URL: ${urlObj.toString()} and method: ${provider.http_method}`);

      // ``redirect: 'error'`` -- see registerManual for rationale (GHSA-9qhg-99ww-9mqc).
      // ``keepalive: false`` -- do not take a pooled socket for the stream. Bun's
      // fetch transparently re-issues a request when a reused keep-alive socket
      // dies mid-response, which would hand the consumer the partial chunks
      // followed by a full replay. Node ignores the option.
      const response = await fetch(urlObj.toString(), {
        method: provider.http_method || 'GET',
        headers: requestHeaders,
        body,
        redirect: 'error',
        signal: controller.signal,
        keepalive: false,
      });

      if (!response.ok) {
        let detail = '';
        try {
          detail = await response.text();
        } catch {
          // ignore body read failures on error responses
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}${detail ? ` - ${detail.slice(0, 200)}` : ''}`);
      }

      for await (const chunk of this._processHttpStream(response, provider.chunk_size, provider.name || toolName)) {
        yield chunk;
      }
    } catch (error: any) {
      this._logError(`Error during HTTP stream for '${provider.name || toolName}': ${error.message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Processes the HTTP response body and yields chunks based on content type.
   */
  private async *_processHttpStream(
    response: Response,
    chunkSize: number | undefined,
    providerName: string,
  ): AsyncGenerator<any, void, unknown> {
    const contentType = response.headers.get('content-type') || '';
    const body = response.body;

    if (!body) {
      // No body (e.g. 204). Nothing to yield.
      return;
    }

    const reader = body.getReader();
    try {
      if (contentType.includes('application/x-ndjson')) {
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        const parseLine = (line: string): any => {
          try {
            return JSON.parse(line);
          } catch {
            this._logError(`Error parsing NDJSON line for '${providerName}': ${line.slice(0, 100)}`);
            return line; // Yield raw line on error
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
            buffer = buffer.slice(newlineIndex + 1);
            if (line.trim()) {
              yield parseLine(line);
            }
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
          yield parseLine(buffer.replace(/\r$/, ''));
        }
      } else if (contentType.includes('application/json')) {
        // Buffer the entire response for a single JSON object
        const parts: Buffer[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(Buffer.from(value));
        }
        const buffer = Buffer.concat(parts);
        if (buffer.length > 0) {
          const text = buffer.toString('utf-8');
          try {
            yield JSON.parse(text);
          } catch {
            this._logError(`Error parsing JSON response for '${providerName}': ${text.slice(0, 100)}`);
            yield buffer; // Yield raw buffer on error
          }
        }
      } else {
        // Binary chunk streaming for application/octet-stream and unknown content types.
        // Re-chunk the network reads so each yielded Buffer is at most chunkSize bytes.
        const size = chunkSize && chunkSize > 0 ? chunkSize : 8192;
        let pending = Buffer.alloc(0);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          pending = pending.length === 0 ? Buffer.from(value) : Buffer.concat([pending, Buffer.from(value)]);
          while (pending.length >= size) {
            yield pending.subarray(0, size);
            pending = pending.subarray(size);
          }
        }
        if (pending.length > 0) {
          yield pending;
        }
      }
    } finally {
      // Release the connection if the consumer stopped early or an error occurred.
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Handles the OAuth2 client-credentials flow, trying credentials in the body
   * first and then as a Basic Auth header. Tokens are cached per full OAuth
   * configuration (token URL, client id, secret, scope), never per client_id
   * alone: two templates may share a client_id but point at different issuers.
   * Both credential methods run under the caller's `signal`, which carries
   * the call's own deadline, so the whole token flow can never exceed it.
   */
  private async _handleOAuth2(authDetails: OAuth2Auth, signal: AbortSignal): Promise<string> {
    const clientId = authDetails.client_id;

    // The token URL may come from an untrusted call template; validate it
    // before the cache is consulted, so a template with a rejected URL never
    // receives a token fetched on behalf of another (GHSA-8cp3-qxj6-px34).
    ensureSecureUrl(authDetails.token_url, 'OAuth2 token URL');

    const cacheKey = JSON.stringify([authDetails.token_url, clientId, authDetails.client_secret, authDetails.scope || '']);
    const cached = this.oauthTokens.get(cacheKey);
    if (cached && (cached.expires_at === undefined || cached.expires_at > Date.now())) {
      return cached.access_token;
    }

    const storeToken = (tokenData: any): string => {
      if (!tokenData || !tokenData.access_token) {
        throw new Error('Access token not found in response.');
      }
      const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
      this.oauthTokens.set(cacheKey, { access_token: tokenData.access_token, expires_at: Date.now() + expiresIn * 1000 });
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
      this._logInfo(`Attempting OAuth2 token fetch for '${clientId}' with credentials in body.`);
      return await requestToken({}, {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: authDetails.client_secret,
        scope: authDetails.scope || '',
      });
    } catch (error: any) {
      this._logError(`OAuth2 with credentials in body failed for '${clientId}': ${error.message}. Trying Basic Auth header.`);
    }

    // Method 2: credentials as a Basic Auth header
    try {
      this._logInfo(`Attempting OAuth2 token fetch for '${clientId}' with Basic Auth header.`);
      const credentials = Buffer.from(`${clientId}:${authDetails.client_secret}`).toString('base64');
      return await requestToken({ 'Authorization': `Basic ${credentials}` }, {
        grant_type: 'client_credentials',
        scope: authDetails.scope || '',
      });
    } catch (error: any) {
      this._logError(`OAuth2 with Basic Auth header also failed for '${clientId}': ${error.message}`);
      throw new Error(`Failed to fetch OAuth2 token for client '${clientId}' after trying all methods. Details: ${error.message}`);
    }
  }

  /**
   * Builds the URL by substituting {param} path parameters from args.
   * Consumed parameters are removed from args so they are not sent as query parameters.
   */
  private _buildUrlWithPathParams(urlTemplate: string, args: Record<string, any>): string {
    return buildUrlWithPathParams(urlTemplate, args);
  }

  /**
   * REQUIRED
   * Close all active connections and clear internal state.
   */
  async close(): Promise<void> {
    this._logInfo('Closing StreamableHttpCommunicationProtocol.');
    this.oauthTokens.clear();
  }
}
