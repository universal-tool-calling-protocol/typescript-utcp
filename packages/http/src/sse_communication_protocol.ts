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
import { IUtcpClient } from '@utcp/sdk';
import { SseCallTemplate } from './sse_call_template';

/**
 * REQUIRED
 * SSE communication protocol implementation for UTCP client.
 * 
 * Handles Server-Sent Events based tool providers with streaming capabilities.
 */
export class SseCommunicationProtocol implements CommunicationProtocol {
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
      }
    }

    return { auth, cookies };
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

    const provider = manualCallTemplate as SseCallTemplate;
    const url = provider.url;

    // Security check: Enforce HTTPS or localhost to prevent MITM attacks
    if (
      !url.startsWith('https://') &&
      !url.startsWith('http://localhost') &&
      !url.startsWith('http://127.0.0.1')
    ) {
      throw new Error(
        `Security error: URL must use HTTPS or start with 'http://localhost' or 'http://127.0.0.1'. Got: ${url}. ` +
          'Non-secure URLs are vulnerable to man-in-the-middle attacks.'
      );
    }

    this._logInfo(`Discovering tools from '${provider.name}' (SSE) at ${url}`);

    try {
      const requestHeaders: Record<string, string> = provider.headers ? { ...provider.headers } : {};
      const queryParams: Record<string, any> = {};
      const { auth, cookies } = this._applyAuth(provider, requestHeaders, queryParams);

      // Build URL with query parameters
      const urlObj = new URL(url);
      Object.entries(queryParams).forEach(([key, value]) => {
        urlObj.searchParams.append(key, String(value));
      });

      // SSE requires Accept: text/event-stream
      requestHeaders['Accept'] = 'text/event-stream';

      // Build fetch options
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: requestHeaders,
      };

      // Add basic auth if present
      if (auth) {
        const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        fetchOptions.headers = {
          ...fetchOptions.headers as Record<string, string>,
          'Authorization': `Basic ${credentials}`,
        };
      }

      // Make discovery request
      const response = await fetch(urlObj.toString(), fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // For SSE discovery, we expect the first event to contain the manual
      // This is a simplified implementation
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
   */
  async callTool(
    caller: IUtcpClient,
    toolName: string,
    toolArgs: Record<string, any>,
    toolCallTemplate: CallTemplate
  ): Promise<any> {
    // For SSE, we collect all events and return them
    const events: string[] = [];
    for await (const event of this.callToolStreaming(caller, toolName, toolArgs, toolCallTemplate)) {
      events.push(event);
    }
    return events;
  }

  /**
   * REQUIRED
   * Call a tool using SSE streaming.
   * Returns an async generator that yields SSE events.
   */
  async *callToolStreaming(
    caller: IUtcpClient,
    toolName: string,
    toolArgs: Record<string, any>,
    toolCallTemplate: CallTemplate
  ): AsyncGenerator<any, void, unknown> {
    const provider = toolCallTemplate as SseCallTemplate;

    // TODO: Implement actual SSE call logic
    // This would involve connecting to the SSE endpoint and streaming events
    this._logInfo(`Calling SSE tool '${toolName}' with args: ${JSON.stringify(toolArgs)}`);
    
    // Placeholder implementation
    yield `SSE event for tool: ${toolName}`;
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
