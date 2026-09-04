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
import { OAuth2Auth } from '@utcp/sdk';
import { IUtcpClient } from '@utcp/sdk';
import { StreamableHttpCallTemplate, StreamableHttpCallTemplateSchema } from './streamable_http_call_template';
import { ensureSecureUrl, assertNoCrlf } from './_security';
import { applyAuth, finalizeAuthHeaders, fetchOAuth2Token, AuthLogger } from './_auth';
import { readErrorDetail } from './_text';
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
  /**
   * Largest NDJSON line the parser buffers (in UTF-16 code units) before
   * declaring the stream malformed. Guards against a server that streams
   * bytes without ever sending a newline.
   */
  public static readonly MAX_LINE_CHARS = 16 * 1024 * 1024;

  private oauthTokens: Map<string, { access_token: string; expires_at?: number }> = new Map();

  private _logInfo(message: string): void {
    console.log(`[StreamableHttpCommunicationProtocol] ${message}`);
  }

  private _logError(message: string): void {
    console.error(`[StreamableHttpCommunicationProtocol] ${message}`);
  }

  private get _authLog(): AuthLogger {
    return { info: (m) => this._logInfo(m), error: (m) => this._logError(m) };
  }

  private _applyAuth(
    provider: StreamableHttpCallTemplate,
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
    provider: StreamableHttpCallTemplate,
    headers: Record<string, string>,
    auth: { username: string; password: string } | undefined,
    cookies: Record<string, string>,
    signal: AbortSignal,
  ): Promise<void> {
    return finalizeAuthHeaders(provider.auth, headers, auth, cookies, signal, this.oauthTokens, this._authLog);
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
          // Bounded read, control characters collapsed, truncated by code point.
          const detail = (await readErrorDetail(response, 200)) || response.statusText;
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

      // Log without the query string: an API key with location 'query', or any
      // sensitive tool argument, would otherwise land in the logs.
      this._logInfo(`Executing streaming HTTP tool '${toolName}' with URL: ${urlObj.origin}${urlObj.pathname} and method: ${provider.http_method}`);

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
        const detail = await readErrorDetail(response, 200);
        throw new Error(`HTTP ${response.status}: ${response.statusText}${detail ? ` - ${detail}` : ''}`);
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
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
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
          if (buffer.length > StreamableHttpCommunicationProtocol.MAX_LINE_CHARS) {
            // A server that never sends a newline must not grow memory until
            // the call deadline; mirrors the SSE event buffer cap.
            throw new Error(
              `NDJSON line exceeded ${StreamableHttpCommunicationProtocol.MAX_LINE_CHARS} characters without a newline`
            );
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
   * consumers and end when the consumer stops iterating, the call deadline
   * fires, or the server closes.
   */
  async close(): Promise<void> {
    this._logInfo('Closing StreamableHttpCommunicationProtocol.');
    this.oauthTokens.clear();
  }
}
