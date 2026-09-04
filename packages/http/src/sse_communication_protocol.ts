/**
 * Server-Sent Events (SSE) Communication Protocol for UTCP.
 *
 * Handles Server-Sent Events based tool providers with streaming capabilities.
 */
// packages/http/src/sse_communication_protocol.ts
import { CommunicationProtocol } from '@utcp/sdk';
import { RegisterManualResult } from '@utcp/sdk';
import { CallTemplate } from '@utcp/sdk';
import { UtcpManual, UtcpManualSerializer } from '@utcp/sdk';
import { ApiKeyAuth } from '@utcp/sdk';
import { BasicAuth } from '@utcp/sdk';
import { OAuth2Auth } from '@utcp/sdk';
import { OAuth2UserAuth } from '@utcp/sdk';
import { IUtcpClient } from '@utcp/sdk';
import { SseCallTemplate, SseCallTemplateSchema } from './sse_call_template';
import { ensureSecureUrl, assertNoCrlf } from './_security';

/**
 * A single parsed Server-Sent Event.
 */
interface SseEvent {
  event?: string;
  id?: string;
  retry?: number;
  /** Joined data lines. Absent for blocks that only carry id/retry/event fields. */
  data?: string;
}

/**
 * REQUIRED
 * SSE communication protocol implementation for UTCP client.
 *
 * Handles Server-Sent Events based tool providers with streaming capabilities.
 *
 * Each SSE event's ``data`` payload is yielded as one chunk. Payloads that
 * parse as JSON are yielded as the parsed value; otherwise the raw string is
 * yielded. When ``event_type`` is set on the call template, only events whose
 * ``event`` field matches are yielded.
 */
export class SseCommunicationProtocol implements CommunicationProtocol {
  /**
   * Upper bound on reconnection attempts for a single tool call when the
   * established stream drops and the call template has `reconnect` enabled.
   * Keeps a tool call bounded even if the server keeps dropping the connection.
   */
  public static readonly MAX_RECONNECT_ATTEMPTS = 5;

  private oauthTokens: Map<string, { access_token: string; expires_at?: number }> = new Map();

  private _logInfo(message: string): void {
    console.log(`[SseCommunicationProtocol] ${message}`);
  }

  private _logError(message: string): void {
    console.error(`[SseCommunicationProtocol] ${message}`);
  }

  private _applyAuth(
    provider: SseCallTemplate,
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
    provider: SseCallTemplate,
    headers: Record<string, string>,
    auth: { username: string; password: string } | undefined,
    cookies: Record<string, string>,
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
      const token = await this._handleOAuth2(provider.auth as OAuth2Auth);
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  /**
   * REQUIRED
   * Register a manual and its tools from an SSE provider.
   */
  async registerManual(
    caller: IUtcpClient,
    manualCallTemplate: CallTemplate
  ): Promise<RegisterManualResult> {
    if ((manualCallTemplate as any).call_template_type !== 'sse') {
      throw new Error('SseCommunicationProtocol can only be used with SseCallTemplate');
    }

    const provider = SseCallTemplateSchema.parse(manualCallTemplate);
    const url = provider.url;

    // Security check: only HTTPS or loopback HTTP allowed for manual discovery.
    ensureSecureUrl(url, 'manual discovery');

    this._logInfo(`Discovering tools from '${provider.name}' (SSE) at ${url}`);

    try {
      const requestHeaders: Record<string, string> = provider.headers ? { ...provider.headers } : {};
      const queryParams: Record<string, any> = {};
      const { auth, cookies } = this._applyAuth(provider, requestHeaders, queryParams);
      await this._finalizeAuthHeaders(provider, requestHeaders, auth, cookies);

      // Build URL with query parameters
      const urlObj = new URL(url);
      Object.entries(queryParams).forEach(([key, value]) => {
        urlObj.searchParams.append(key, String(value));
      });

      // ``redirect: 'error'`` refuses to follow 3xx responses on the SSE
      // handshake -- the streaming response has to stay open for the
      // lifetime of the tool call, which is incompatible with a per-hop
      // revalidator, and SSE redirects are pathological in practice.
      // Without this, an attacker-controlled endpoint could 302 the
      // handshake into an internal service (GHSA-9qhg-99ww-9mqc).
      const response = await fetch(urlObj.toString(), {
        method: 'GET',
        headers: requestHeaders,
        redirect: 'error',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Discovery returns the manual as a plain JSON document.
      const responseText = await response.text();
      const utcpManual = new UtcpManualSerializer().validateDict(JSON.parse(responseText));

      this._logInfo(`Discovered ${utcpManual.tools.length} tools from '${provider.name}'`);

      return {
        manualCallTemplate: provider,
        manual: utcpManual,
        success: true,
        errors: [],
      };
    } catch (error: any) {
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
   * Deregister a manual (no-op for SSE).
   */
  async deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void> {
    // No-op for SSE
  }

  /**
   * REQUIRED
   * Call a tool using SSE (non-streaming).
   *
   * Consumes the whole event stream and returns every event payload as an array.
   */
  async callTool(
    caller: IUtcpClient,
    toolName: string,
    toolArgs: Record<string, any>,
    toolCallTemplate: CallTemplate
  ): Promise<any> {
    const events: any[] = [];
    for await (const event of this.callToolStreaming(caller, toolName, toolArgs, toolCallTemplate)) {
      events.push(event);
    }
    return events;
  }

  /**
   * REQUIRED
   * Call a tool using SSE streaming.
   * Returns an async generator that yields the payload of each SSE event.
   */
  async *callToolStreaming(
    caller: IUtcpClient,
    toolName: string,
    toolArgs: Record<string, any>,
    toolCallTemplate: CallTemplate
  ): AsyncGenerator<any, void, unknown> {
    if ((toolCallTemplate as any).call_template_type !== 'sse') {
      throw new Error('SseCommunicationProtocol can only be used with SseCallTemplate');
    }
    const provider = SseCallTemplateSchema.parse(toolCallTemplate);

    const requestHeaders: Record<string, string> = provider.headers ? { ...provider.headers } : {};
    let bodyContent: any = undefined;
    const remainingArgs: Record<string, any> = { ...toolArgs };
    requestHeaders['Accept'] = 'text/event-stream';

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

    if (provider.body_field && provider.body_field in remainingArgs) {
      bodyContent = remainingArgs[provider.body_field];
      delete remainingArgs[provider.body_field];
    }

    // Build the URL with path parameters substituted
    const url = this._buildUrlWithPathParams(provider.url, remainingArgs);

    // Security check: re-validate the resolved URL before each invocation.
    ensureSecureUrl(url, 'tool invocation');

    // The rest of the arguments are query parameters
    const queryParams: Record<string, any> = { ...remainingArgs };

    // Handle authentication
    const { auth, cookies } = this._applyAuth(provider, requestHeaders, queryParams);
    await this._finalizeAuthHeaders(provider, requestHeaders, auth, cookies);

    const urlObj = new URL(url);
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      urlObj.searchParams.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    });

    // Mirror the Python implementation: POST when a body is present, GET otherwise.
    const method = bodyContent !== undefined ? 'POST' : 'GET';
    let body: BodyInit | undefined = undefined;
    if (bodyContent !== undefined) {
      const contentTypeEntry = Object.entries(requestHeaders).find(([h]) => h.toLowerCase() === 'content-type');
      if (!contentTypeEntry) {
        requestHeaders['Content-Type'] = 'application/json';
      }
      const contentType = contentTypeEntry?.[1] || 'application/json';
      if (contentType.includes('application/json')) {
        body = JSON.stringify(bodyContent);
      } else if (typeof bodyContent === 'string' || bodyContent instanceof Uint8Array || bodyContent instanceof ArrayBuffer) {
        body = bodyContent as BodyInit;
      } else {
        body = JSON.stringify(bodyContent);
      }
    }

    this._logInfo(`Executing SSE tool '${toolName}' with URL: ${urlObj.toString()} and method: ${method}`);

    const providerName = provider.name || toolName;
    const eventType = provider.event_type ?? undefined;
    const reconnect = provider.reconnect !== false;
    let retryDelayMs = provider.retry_timeout;
    let lastEventId: string | undefined;
    let reconnectAttempts = 0;

    while (true) {
      const attemptHeaders: Record<string, string> = { ...requestHeaders };
      if (lastEventId !== undefined) {
        // Let the server resume from where we left off (SSE spec).
        attemptHeaders['Last-Event-ID'] = lastEventId;
      }

      let response: Response;
      try {
        // ``redirect: 'error'`` -- see registerManual for rationale (GHSA-9qhg-99ww-9mqc).
        // ``keepalive: false`` -- do not take a pooled socket for the stream. Bun's
        // fetch transparently re-issues a request when a reused keep-alive socket
        // dies mid-response, which would bypass this reconnect logic (no
        // Last-Event-ID, ``reconnect: false`` ignored, duplicated events). Node
        // ignores the option. A fresh connection per streaming call is cheap.
        response = await fetch(urlObj.toString(), {
          method,
          headers: attemptHeaders,
          body,
          redirect: 'error',
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
      } catch (error: any) {
        // Failing to establish the connection (or a non-2xx status) is a
        // definitive answer, not a connection loss: fail fast, no retry.
        this._logError(`Error establishing SSE connection to '${providerName}': ${error.message}`);
        throw error;
      }

      try {
        for await (const event of this._iterSseEvents(response)) {
          if (event.id !== undefined) {
            lastEventId = event.id;
          }
          if (event.retry !== undefined) {
            retryDelayMs = event.retry;
          }
          if (event.data === undefined) {
            continue;
          }
          if (eventType && event.event !== eventType) {
            continue;
          }
          yield this._parseEventData(event.data);
        }
        // The server ended the stream cleanly: the tool call is complete.
        return;
      } catch (error: any) {
        reconnectAttempts += 1;
        if (!reconnect || reconnectAttempts > SseCommunicationProtocol.MAX_RECONNECT_ATTEMPTS) {
          this._logError(`SSE connection to '${providerName}' lost and not reconnecting: ${error.message}`);
          throw error;
        }
        this._logInfo(
          `SSE connection to '${providerName}' lost (${error.message}); reconnecting in ${retryDelayMs} ms ` +
          `(attempt ${reconnectAttempts}/${SseCommunicationProtocol.MAX_RECONNECT_ATTEMPTS})`
        );
      }

      await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  /**
   * Returns the JSON-decoded payload when possible, otherwise the raw string.
   */
  private _parseEventData(data: string): any {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  /**
   * Parses the SSE wire format from the response body and yields one
   * {@link SseEvent} per event block. Blocks that only carry id/retry fields
   * are yielded too (without data) so the caller can track reconnection state.
   * A read error (connection loss) propagates to the caller.
   */
  private async *_iterSseEvents(response: Response): AsyncGenerator<SseEvent, void, unknown> {
    const body = response.body;
    if (!body) {
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Normalise CRLF / CR line endings to LF so the event delimiter is always "\n\n".
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        let delimiterIndex: number;
        while ((delimiterIndex = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, delimiterIndex);
          buffer = buffer.slice(delimiterIndex + 2);
          const event = this._parseSseEvent(rawEvent);
          if (event) {
            yield event;
          }
        }
      }

      // Flush a trailing event that was not terminated by a blank line.
      buffer += decoder.decode();
      const trailing = this._parseSseEvent(buffer);
      if (trailing) {
        yield trailing;
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
   * Parses one SSE event block (lines separated by "\n"). Returns undefined
   * for blocks with no fields at all (blank / comment-only keep-alives).
   */
  private _parseSseEvent(rawEvent: string): SseEvent | undefined {
    if (!rawEvent.trim()) {
      return undefined;
    }

    const event: SseEvent = {};
    const dataLines: string[] = [];

    for (const line of rawEvent.split('\n')) {
      if (line.startsWith(':')) {
        continue; // comment
      }
      const colonIndex = line.indexOf(':');
      let field: string;
      let value: string;
      if (colonIndex === -1) {
        field = line;
        value = '';
      } else {
        field = line.slice(0, colonIndex);
        value = line.slice(colonIndex + 1);
        if (value.startsWith(' ')) {
          value = value.slice(1);
        }
      }

      if (field === 'event') {
        event.event = value;
      } else if (field === 'data') {
        dataLines.push(value);
      } else if (field === 'id') {
        event.id = value;
      } else if (field === 'retry') {
        const retry = parseInt(value, 10);
        if (!Number.isNaN(retry)) {
          event.retry = retry;
        }
      }
    }

    if (dataLines.length > 0) {
      event.data = dataLines.join('\n');
    }

    return Object.keys(event).length > 0 ? event : undefined;
  }

  /**
   * Handles the OAuth2 client-credentials flow, trying credentials in the body
   * first and then as a Basic Auth header. Tokens are cached per client_id.
   */
  private async _handleOAuth2(authDetails: OAuth2Auth): Promise<string> {
    const clientId = authDetails.client_id;
    const cached = this.oauthTokens.get(clientId);
    if (cached && (cached.expires_at === undefined || cached.expires_at > Date.now())) {
      return cached.access_token;
    }

    // The token URL may come from an untrusted call template; validate it
    // before posting credentials (GHSA-8cp3-qxj6-px34).
    ensureSecureUrl(authDetails.token_url, 'OAuth2 token URL');

    const storeToken = (tokenData: any): string => {
      if (!tokenData || !tokenData.access_token) {
        throw new Error('Access token not found in response.');
      }
      const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
      this.oauthTokens.set(clientId, { access_token: tokenData.access_token, expires_at: Date.now() + expiresIn * 1000 });
      return tokenData.access_token;
    };

    // Method 1: credentials in the request body
    try {
      this._logInfo(`Attempting OAuth2 token fetch for '${clientId}' with credentials in body.`);
      const bodyData = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: authDetails.client_secret,
        scope: authDetails.scope || '',
      });
      const response = await fetch(authDetails.token_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyData.toString(),
        redirect: 'error',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return storeToken(await response.json());
    } catch (error: any) {
      this._logError(`OAuth2 with credentials in body failed for '${clientId}': ${error.message}. Trying Basic Auth header.`);
    }

    // Method 2: credentials as a Basic Auth header
    try {
      this._logInfo(`Attempting OAuth2 token fetch for '${clientId}' with Basic Auth header.`);
      const bodyData = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: authDetails.scope || '',
      });
      const credentials = Buffer.from(`${clientId}:${authDetails.client_secret}`).toString('base64');
      const response = await fetch(authDetails.token_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`,
        },
        body: bodyData.toString(),
        redirect: 'error',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return storeToken(await response.json());
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
    let url = urlTemplate;
    const pathParams = urlTemplate.match(/\{([^}]+)\}/g) || [];

    for (const param of pathParams) {
      const paramName = param.slice(1, -1);
      if (paramName in args) {
        // URL-encode the parameter value to prevent path injection
        url = url.replace(param, encodeURIComponent(String(args[paramName])));
        delete args[paramName];
      } else {
        throw new Error(`Missing required path parameter: ${paramName}`);
      }
    }

    const remainingParams = url.match(/\{([^}]+)\}/g);
    if (remainingParams && remainingParams.length > 0) {
      throw new Error(`Missing required path parameters in URL template: ${remainingParams.join(', ')}`);
    }

    return url;
  }

  /**
   * REQUIRED
   * Close all active connections and clear internal state.
   */
  async close(): Promise<void> {
    this._logInfo('Closing SseCommunicationProtocol.');
    this.oauthTokens.clear();
  }
}
