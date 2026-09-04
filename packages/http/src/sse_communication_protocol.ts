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
import { OAuth2Auth } from '@utcp/sdk';
import { IUtcpClient } from '@utcp/sdk';
import { SseCallTemplate, SseCallTemplateSchema } from './sse_call_template';
import { ensureSecureUrl, assertNoCrlf } from './_security';
import { applyAuth, finalizeAuthHeaders, fetchOAuth2Token, AuthLogger } from './_auth';
import { readErrorDetail } from './_text';
import { buildUrlWithPathParams } from './_url';

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
 * The server violated the SSE wire format. Not a connection loss, so it is
 * never retried.
 */
export class SseProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SseProtocolError';
  }
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
  /**
   * Cap on the delay before a reconnect, whatever `retry_timeout` or a
   * server-sent `retry:` field asks for. Together with MAX_RECONNECT_ATTEMPTS
   * this bounds the total time a call can spend waiting to reconnect.
   */
  public static readonly MAX_RECONNECT_DELAY_MS = 60_000;
  /**
   * Time allowed for the SSE handshake, i.e. until response headers arrive.
   * Reading the body is unbounded: an SSE stream may legitimately stay quiet.
   */
  public static readonly HANDSHAKE_TIMEOUT_MS = 30_000;
  /**
   * Largest partial event the parser buffers (in UTF-16 code units) before
   * declaring the stream malformed. Guards against a server that streams
   * data without ever sending the blank-line event delimiter.
   */
  public static readonly MAX_EVENT_BUFFER_CHARS = 16 * 1024 * 1024;

  private oauthTokens: Map<string, { access_token: string; expires_at?: number }> = new Map();

  private _logInfo(message: string): void {
    console.log(`[SseCommunicationProtocol] ${message}`);
  }

  private _logError(message: string): void {
    console.error(`[SseCommunicationProtocol] ${message}`);
  }

  private get _authLog(): AuthLogger {
    return { info: (m) => this._logInfo(m), error: (m) => this._logError(m) };
  }

  private _applyAuth(
    provider: SseCallTemplate,
    headers: Record<string, string>,
    queryParams: Record<string, any>
  ): { auth?: { username: string; password: string }; cookies: Record<string, string> } {
    return applyAuth(provider.auth, headers, queryParams, this._authLog);
  }

  /**
   * Applies Basic auth, cookies and (if configured) an OAuth2 client-credentials
   * bearer token to the request headers. Shared with the other fetch-based
   * protocol via _auth.ts so security fixes land in one place.
   */
  private async _finalizeAuthHeaders(
    provider: SseCallTemplate,
    headers: Record<string, string>,
    auth: { username: string; password: string } | undefined,
    cookies: Record<string, string>,
    signal: AbortSignal,
  ): Promise<void> {
    return finalizeAuthHeaders(provider.auth, headers, auth, cookies, signal, this.oauthTokens, this._authLog);
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

    // One handshake-sized deadline for the whole discovery call, token fetch included.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SseCommunicationProtocol.HANDSHAKE_TIMEOUT_MS);
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
        signal: controller.signal,
      });

      if (!response.ok) {
        // Read the body before throwing — servers put the real reason there
        // (e.g. { "error": "..." }); discarding it leaves callers with only a
        // status code. Fall back to statusText when the body is empty.
        // Bounded read, control characters collapsed, truncated by code point.
        const detail = (await readErrorDetail(response, 200)) || response.statusText;
        throw new Error(`HTTP ${response.status}: ${detail}`);
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
    } finally {
      clearTimeout(timer);
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

    // Handle authentication. The token fetch (both credential methods) shares
    // one handshake-sized deadline so a stalled token endpoint cannot hang the call.
    const { auth, cookies } = this._applyAuth(provider, requestHeaders, queryParams);
    const authController = new AbortController();
    const authTimer = setTimeout(() => authController.abort(), SseCommunicationProtocol.HANDSHAKE_TIMEOUT_MS);
    try {
      await this._finalizeAuthHeaders(provider, requestHeaders, auth, cookies, authController.signal);
    } finally {
      clearTimeout(authTimer);
    }

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

    // Log without the query string: an API key with location 'query', or any
    // sensitive tool argument, would otherwise land in the logs.
    this._logInfo(`Executing SSE tool '${toolName}' with URL: ${urlObj.origin}${urlObj.pathname} and method: ${method}`);

    const providerName = provider.name || toolName;
    const eventType = provider.event_type ?? undefined;
    // Never re-send a request body: a reconnect re-issues the request, and for
    // a POST that would re-execute a possibly non-idempotent tool.
    const reconnect = provider.reconnect !== false && bodyContent === undefined;
    const reconnectSuppressedByBody = provider.reconnect !== false && bodyContent !== undefined;
    let retryDelayMs = provider.retry_timeout;
    let lastEventId: string | undefined;
    let reconnectAttempts = 0;

    while (true) {
      const attemptHeaders: Record<string, string> = { ...requestHeaders };
      if (lastEventId) {
        // Let the server resume from where we left off (SSE spec). An empty
        // last event ID means "none": the header is not sent.
        attemptHeaders['Last-Event-ID'] = lastEventId;
      }

      const delayMs = () => Math.min(retryDelayMs, SseCommunicationProtocol.MAX_RECONNECT_DELAY_MS);

      let response: Response;
      // Bound the handshake only: the signal is dropped once headers arrive,
      // so a quiet stream is never cut off.
      const handshake = new AbortController();
      const handshakeTimer = setTimeout(() => handshake.abort(), SseCommunicationProtocol.HANDSHAKE_TIMEOUT_MS);
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
          signal: handshake.signal,
        });

        if (!response.ok) {
          const detail = await readErrorDetail(response, 200);
          throw new Error(`HTTP ${response.status}: ${response.statusText}${detail ? ` - ${detail}` : ''}`);
        }

        // Anything but an event stream would be parsed into silence: a JSON
        // error document, say, yields zero events and a "successful" call.
        const contentType = response.headers.get('content-type') || '';
        // Compare the media type exactly (parameters such as charset allowed),
        // so "text/event-stream-invalid" does not pass a substring check.
        const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
        if (mediaType !== 'text/event-stream') {
          try {
            await response.body?.cancel();
          } catch {
            // ignore
          }
          throw new SseProtocolError(
            `Expected a text/event-stream response but got '${contentType || 'no Content-Type'}'`
          );
        }
      } catch (error: any) {
        if (error instanceof SseProtocolError) {
          throw error;
        }
        if (reconnectAttempts === 0) {
          // The initial handshake failing (refused, timed out, non-2xx) is a
          // definitive answer about the endpoint: fail fast, no retry.
          this._logError(`Error establishing SSE connection to '${providerName}': ${error.message}`);
          throw error;
        }
        // A reconnect handshake failing is part of the outage we are riding
        // out (the server may still be restarting): count it and try again.
        reconnectAttempts += 1;
        if (reconnectAttempts > SseCommunicationProtocol.MAX_RECONNECT_ATTEMPTS) {
          this._logError(`SSE reconnect to '${providerName}' failed and attempts are exhausted: ${error.message}`);
          throw error;
        }
        this._logInfo(
          `SSE reconnect to '${providerName}' failed (${error.message}); retrying in ${delayMs()} ms ` +
          `(attempt ${reconnectAttempts}/${SseCommunicationProtocol.MAX_RECONNECT_ATTEMPTS})`
        );
        await new Promise<void>(resolve => setTimeout(resolve, delayMs()));
        continue;
      } finally {
        clearTimeout(handshakeTimer);
      }

      try {
        for await (const event of this._iterSseEvents(response)) {
          // Per the SSE spec an id containing NUL is ignored, and an empty id
          // resets the last event ID.
          if (event.id !== undefined && !event.id.includes('\0')) {
            lastEventId = event.id;
          }
          if (event.retry !== undefined) {
            retryDelayMs = event.retry;
          }
          if (event.data === undefined) {
            continue;
          }
          // An event block without an `event:` field has the type "message".
          if (eventType && (event.event || 'message') !== eventType) {
            continue;
          }
          yield this._parseEventData(event.data);
        }
        // The server ended the stream cleanly: the tool call is complete.
        return;
      } catch (error: any) {
        if (error instanceof SseProtocolError) {
          // A malformed stream is the server's doing, not a connection loss.
          this._logError(`Malformed SSE stream from '${providerName}': ${error.message}`);
          throw error;
        }
        reconnectAttempts += 1;
        if (!reconnect || reconnectAttempts > SseCommunicationProtocol.MAX_RECONNECT_ATTEMPTS) {
          const why = reconnectSuppressedByBody
            ? ' (reconnection is disabled for calls that send a request body, since a re-issued POST could re-execute the tool)'
            : '';
          this._logError(`SSE connection to '${providerName}' lost and not reconnecting${why}: ${error.message}`);
          throw error;
        }
        this._logInfo(
          `SSE connection to '${providerName}' lost (${error.message}); reconnecting in ${delayMs()} ms ` +
          `(attempt ${reconnectAttempts}/${SseCommunicationProtocol.MAX_RECONNECT_ATTEMPTS})`
        );
      }

      await new Promise<void>(resolve => setTimeout(resolve, delayMs()));
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
    // A "\r" that ended the previous chunk is held back until the next chunk
    // shows whether a "\n" follows; otherwise a CRLF split across two reads
    // would become two LFs and dispatch an event early.
    let pendingCr = false;
    const normalise = (chunk: string): string => {
      let text = chunk;
      if (pendingCr) {
        text = '\r' + text;
        pendingCr = false;
      }
      if (text.endsWith('\r')) {
        text = text.slice(0, -1);
        pendingCr = true;
      }
      // Normalise CRLF / CR line endings to LF so the event delimiter is always "\n\n".
      return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += normalise(decoder.decode(value, { stream: true }));

        let delimiterIndex: number;
        while ((delimiterIndex = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, delimiterIndex);
          buffer = buffer.slice(delimiterIndex + 2);
          const event = this._parseSseEvent(rawEvent);
          if (event) {
            yield event;
          }
        }

        if (buffer.length > SseCommunicationProtocol.MAX_EVENT_BUFFER_CHARS) {
          throw new SseProtocolError(
            `SSE event exceeded ${SseCommunicationProtocol.MAX_EVENT_BUFFER_CHARS} characters without a blank-line delimiter`
          );
        }
      }

      // At end of stream, a held-back CR is a real line terminator and may
      // complete the closing blank line of the last event. Dispatch whatever
      // is fully delimited; per spec, an event still incomplete after that
      // (no final blank line) is discarded.
      buffer += normalise(decoder.decode());
      if (pendingCr) {
        buffer += '\n';
        pendingCr = false;
      }
      let delimiterIndex: number;
      while ((delimiterIndex = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 2);
        const event = this._parseSseEvent(rawEvent);
        if (event) {
          yield event;
        }
      }
      // The residual (discarded) buffer is still subject to the cap, so an
      // over-limit malformed stream fails the same way at end of stream.
      if (buffer.length > SseCommunicationProtocol.MAX_EVENT_BUFFER_CHARS) {
        throw new SseProtocolError(
          `SSE event exceeded ${SseCommunicationProtocol.MAX_EVENT_BUFFER_CHARS} characters without a blank-line delimiter`
        );
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
        // Spec: only a value made of ASCII digits sets the reconnection time.
        // An absurdly long digit string parses to Infinity and is ignored.
        if (/^[0-9]+$/.test(value) && Number.isFinite(Number(value))) {
          event.retry = Number(value);
        }
      }
    }

    if (dataLines.length > 0) {
      event.data = dataLines.join('\n');
    }

    return Object.keys(event).length > 0 ? event : undefined;
  }

  /**
   * OAuth2 client-credentials flow, shared via _auth.ts.
   */
  private async _handleOAuth2(authDetails: OAuth2Auth, signal: AbortSignal): Promise<string> {
    return fetchOAuth2Token(authDetails, signal, this.oauthTokens, this._authLog);
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
   * Clear cached OAuth2 tokens. Streams in flight are owned by their
   * consumers and end when the consumer stops iterating or the server closes.
   */
  async close(): Promise<void> {
    this._logInfo('Closing SseCommunicationProtocol.');
    this.oauthTokens.clear();
  }
}
