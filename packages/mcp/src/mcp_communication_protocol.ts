// packages/mcp/src/mcp_communication_protocol.ts
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport, StreamableHTTPClientTransportOptions, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import axios, { AxiosInstance } from 'axios';
import { CommunicationProtocol } from '@utcp/sdk';
import { RegisterManualResult } from '@utcp/sdk';
import { CallTemplate } from '@utcp/sdk';
import { UtcpManualSchema } from '@utcp/sdk';
import { Tool, JsonSchema } from '@utcp/sdk';
import { Auth, OAuth2Auth, OAuth2UserAuth } from '@utcp/sdk';
import { IUtcpClient } from '@utcp/sdk';

/** Defense-in-depth: refuse CR/LF in attacker-influenceable strings
 *  that will land in HTTP headers. */
function assertNoCrlf(value: string | undefined, fieldName: string): void {
  if (typeof value !== 'string') return;
  if (value.includes('\r') || value.includes('\n')) {
    throw new Error(
      `Refusing to construct request: ${fieldName} contains CR/LF, ` +
        `which would enable HTTP header injection.`,
    );
  }
}

/**
 * Minimal HTTPS-or-loopback URL guard for the MCP HTTP transport.
 * Mirrors the validator in `@utcp/http`'s `_security.ts` to keep MCP
 * from being a back-door SSRF vector when the MCP call template comes
 * from an attacker-influenceable source (e.g. a discovered manual).
 * Hostname-based -- not prefix-based -- so the bypass from
 * GHSA-39j6-4867-gg4w / CVE-2026-44661 (`http://localhost.evil.com`)
 * is rejected.
 */
const MCP_LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
]);

function ensureSecureMcpUrl(rawUrl: string, context: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      `Security error during ${context}: not a valid URL: ${JSON.stringify(rawUrl)}.`,
    );
  }
  const scheme = parsed.protocol.toLowerCase();
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (scheme === 'https:') return;
  if (scheme === 'http:' && MCP_LOOPBACK_HOSTNAMES.has(host)) return;
  // Match the broader 127.0.0.0/8 + 0.0.0.0 + IPv4-mapped IPv6
  // loopback set that ``isLoopbackUrl`` in @utcp/http covers, so an
  // attacker can't paper over the hostname check with `127.0.0.2`.
  if (scheme === 'http:') {
    const v4 = host.match(/^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    if (v4 && parseInt(v4[1], 10) === 127) return;
    if (host === '0.0.0.0' || host === '::') return;
    if (host.startsWith('::ffff:')) {
      const tail = host.slice('::ffff:'.length);
      const tailV4 = tail.match(/^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      if (tailV4 && parseInt(tailV4[1], 10) === 127) return;
      const tailHex = tail.match(/^([0-9a-f]{1,4}):[0-9a-f]{1,4}$/);
      if (tailHex && ((parseInt(tailHex[1], 16) >>> 8) & 0xff) === 127) return;
    }
  }
  throw new Error(
    `Security error during ${context}: URL must use HTTPS or be a literal ` +
      `loopback address. Got: ${JSON.stringify(rawUrl)}. Plain HTTP to any ` +
      `other host is rejected to prevent MITM attacks and SSRF into ` +
      `internal services.`,
  );
}
import { McpCallTemplateSchema, McpHttpServer, McpHttpServerSchema, McpServerConfig, McpStdioServer } from './mcp_call_template';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import $RefParser from '@apidevtools/json-schema-ref-parser';

// Define a simple type for the tool objects returned by MCP's listTools
interface McpToolResponse {
  name: string;
  description?: string;
  inputSchema: unknown;
  outputSchema: unknown;
}

// Type guard to check if an object is a valid MCP tools response
function isMcpToolsResponse(data: unknown): data is { tools: McpToolResponse[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'tools' in data &&
    Array.isArray((data as any).tools)
  );
}

/**
 * MCP communication protocol implementation for the UTCP client.
 *
 * This implementation connects to MCP servers via stdio or HTTP, managing
 * persistent sessions to enhance performance and stability. It includes
 * logic for session reuse and automatic recovery from connection errors.
 */
export class McpCommunicationProtocol implements CommunicationProtocol {
  private _oauthTokens: Map<string, { accessToken: string; expiresAt: number }> = new Map();
  /**
   * In-flight token fetches, keyed like the token cache (by client_id). A burst
   * of concurrent first-time callers shares one request instead of each POSTing
   * to the token endpoint. (Promises are not cancellable in JS, so unlike the
   * Python plugin no shielding is needed — extra awaiters cannot abort the fetch.)
   */
  private _oauthInflight: Map<string, Promise<{ accessToken: string; expiresAt: number }>> = new Map();
  /**
   * Per-client invalidation counter. A token fetch captures the generation
   * when it starts and only caches its result if nothing invalidated the
   * client in the meantime — otherwise an in-flight fetch that began before
   * a 401 would repopulate the cache right after `_invalidateOAuthToken`
   * cleared it.
   */
  private _oauthGenerations: Map<string, number> = new Map();
  private _axiosInstance: AxiosInstance;
  private _mcpSessions: Map<string, McpClient> = new Map();
  /**
   * `close()` is a DRAIN, not a terminal state. This instance is registered
   * once at module load (`index.ts`) into the process-wide
   * `CommunicationProtocol.communicationProtocols` registry, and EVERY
   * `UtcpClient` shares it — `UtcpClient.close()` closes the registered
   * protocols, so one client closing must not brick MCP for every other
   * client in the process (which is exactly what a sticky closed flag did).
   *
   * `_activeDrains` counts close() sweeps currently running — session
   * creation refuses while ANY is in flight. A counter, not a boolean:
   * two overlapping close() calls each clear a boolean on their own way
   * out, so the faster one (a second close sees an already-emptied cache
   * and finishes immediately) would reopen the gate while the first sweep
   * is still awaiting a transport's close() — letting a new session dial
   * and cache itself inside that outstanding close, which then returns
   * with live resources behind it. `_closeGeneration` increments at each
   * close: creation captures it on entry and re-checks it before dialing
   * (a close can land during the OAuth token fetch) and again after
   * `connect()` resolves (the sweep snapshots the cache before an
   * in-flight connect has landed, so a session caching itself afterwards
   * would otherwise outlive the close with a live transport).
   */
  private _activeDrains = 0;
  private _closeGeneration = 0;

  constructor() {
    this._axiosInstance = axios.create({ timeout: 30000 });
  }

  private _logInfo(message: string): void {
    console.log(`[McpCommunicationProtocol] ${message}`);
  }

  private _logError(message: string, error?: any): void {
    console.error(`[McpCommunicationProtocol Error] ${message}`, error);
  }

  /**
   * Dereferences a JSON Schema by resolving all $refs and $defs.
   * This fixes the issue with FastMCP 2.0+ servers that use $defs references.
   * 
   * @param schema - The schema to dereference
   * @returns The dereferenced schema with all references inlined
   */
  private async _dereferenceSchema(schema: unknown): Promise<JsonSchema> {
    if (!schema || typeof schema !== 'object') {
      return schema as JsonSchema;
    }
    
    try {
      // Check if schema contains $defs or $ref
      const schemaStr = JSON.stringify(schema);
      if (!schemaStr.includes('$defs') && !schemaStr.includes('$ref')) {
        // No refs to resolve, return as-is
        return schema as JsonSchema;
      }
      
      // Dereference the schema (inlines all $refs and $defs). `circular:
      // 'ignore'` keeps recursive schemas (e.g. self-referencing filter
      // grammars) from throwing — the cycle is left as a live reference
      // instead of failing the whole tool discovery.
      const dereferenced = await $RefParser.dereference(schema as any, {
        dereference: { circular: 'ignore' },
      });
      return dereferenced as JsonSchema;
    } catch (error: any) {
      // If dereferencing fails, log a warning and return the original schema
      this._logError(`Failed to dereference schema, using original:`, error.message);
      return schema as JsonSchema;
    }
  }

  /**
   * Close a session and drop it from the cache — identity-aware. Pass
   * `expected` (the client the caller actually saw fail) so a concurrent
   * caller's replacement session is never closed by mistake: if the cache no
   * longer holds `expected`, only `expected` itself is closed and the cached
   * entry is left alone.
   *
   * The cache delete happens BEFORE the `await close()`, not after it: with
   * the delete in a `finally`, a concurrent `_getOrCreateSession` landing
   * during the close would have its freshly cached session deleted out from
   * under it.
   */
  private async _cleanupSession(sessionKey: string, expected?: McpClient): Promise<void> {
    const cached = this._mcpSessions.get(sessionKey);
    const target = expected ?? cached;
    if (!target) return;
    if (cached === target) {
      this._mcpSessions.delete(sessionKey);
    }
    try {
      await target.close();
      this._logInfo(`Closed MCP session for '${sessionKey}'.`);
    } catch (e: any) {
      this._logError(`Error closing session for '${sessionKey}':`, e.message);
    }
  }

  /**
   * Drop a cached client-credentials OAuth token after the server rejected
   * it. The cache trusts `expires_in`, but a token can be revoked server-side
   * before its local expiry — without this, every post-eviction redial would
   * resend the same rejected token until the TTL ran out, so evicting the
   * session alone would fix nothing. `oauth2_user` tokens are provisioned
   * out-of-band and never cached here, so there is nothing to invalidate for
   * them.
   */
  private _invalidateOAuthToken(auth: Auth | undefined): void {
    if (!auth || auth.auth_type === 'oauth2_user') return;
    const clientId = (auth as OAuth2Auth).client_id;
    if (!clientId) return;
    // Bump the generation whether or not a token was cached: a fetch may be
    // in flight right now, and it must not cache what it brings back.
    this._oauthGenerations.set(clientId, this._oauthGeneration(clientId) + 1);
    if (this._oauthTokens.delete(clientId)) {
      this._logInfo(`Dropped cached OAuth token for client '${clientId}' after an auth rejection.`);
    }
  }

  private _oauthGeneration(clientId: string): number {
    return this._oauthGenerations.get(clientId) ?? 0;
  }

  private async _getOrCreateSession(
    serverName: string,
    serverConfig: McpServerConfig,
    auth?: Auth
  ): Promise<McpClient> {
    const sessionKey = `${serverName}:${serverConfig.transport}`;

    // Check if we have an existing session
    if (this._mcpSessions.has(sessionKey)) {
      const existingSession = this._mcpSessions.get(sessionKey)!;
      this._logInfo(`Reusing existing MCP session for '${sessionKey}'.`);
      return existingSession;
    }

    // Worded without the transient markers ("closed", "disconnected") on
    // purpose, so `_withSession` does not classify shutdown as a transport
    // hiccup and spend a retry on it.
    if (this._activeDrains > 0) {
      throw new Error(`McpCommunicationProtocol is shutting down; refusing to create a session for '${sessionKey}'.`);
    }
    const closeGenerationAtStart = this._closeGeneration;

    this._logInfo(`Creating new MCP session for '${sessionKey}'...`);
    let transport: Transport;

    if (serverConfig.transport === 'stdio') {
      const stdioConfig = serverConfig as McpStdioServer;

      const combinedEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ...(stdioConfig.env || {}),
      };

      transport = new StdioClientTransport({
        command: stdioConfig.command,
        args: stdioConfig.args || [],
        cwd: stdioConfig.cwd,
        env: combinedEnv,
        // Default the child's stderr to 'ignore' so a chatty MCP server does
        // not flood the host terminal during discovery. NOT 'pipe': with no
        // reader attached the OS pipe buffer fills and a verbose child
        // deadlocks. Set UTCP_MCP_CHILD_STDERR=inherit to see child stderr
        // when debugging.
        stderr: process.env.UTCP_MCP_CHILD_STDERR === 'inherit' ? 'inherit' : 'ignore',
      });

    } else if (serverConfig.transport === 'http') {
      // PARSE, not cast: server entries travel as `z.any()` inside
      // McpConfigSchema (official-MCP-config compatibility), so this is the
      // one point where the per-field schema actually applies — defaults
      // (notification_stream_max_retries: 0 among them) take effect and the
      // documented rejections (negative/fractional retry caps) really reject
      // instead of flowing into the transport.
      const httpConfig: McpHttpServer = McpHttpServerSchema.parse(serverConfig);
      // Reject plain-HTTP non-loopback URLs and obvious SSRF targets
      // before any connection attempt. Matches the trust boundary
      // @utcp/http enforces for its own discovery / invocation URLs.
      ensureSecureMcpUrl(httpConfig.url, 'MCP HTTP transport');
      let authHeader: Record<string, string> = {};
      if (auth) {
        if (auth.auth_type === 'oauth2_user') {
          // Interactive (user-delegated) OAuth2: token provisioned out-of-band
          // by a login tool (e.g. `code-mode login <manual>`). No fetch here.
          const userAuth = auth as OAuth2UserAuth;
          if (!userAuth.access_token) {
            throw new Error("access_token for oauth2_user auth is empty. Run an interactive login (e.g. `code-mode login <manual>`) to provision it.");
          }
          const headerName = userAuth.var_name || 'Authorization';
          const prefix = userAuth.prefix ?? 'Bearer ';
          assertNoCrlf(headerName, 'OAuth2UserAuth.var_name');
          assertNoCrlf(prefix, 'OAuth2UserAuth.prefix');
          assertNoCrlf(userAuth.access_token, 'OAuth2UserAuth.access_token');
          authHeader[headerName] = `${prefix}${userAuth.access_token}`;
        } else {
          const token = await this._handleOAuth2(auth as OAuth2Auth);
          authHeader['Authorization'] = `Bearer ${token}`;
        }
      }

      const transportOptions: StreamableHTTPClientTransportOptions = {
        requestInit: { headers: { ...(httpConfig.headers || {}), ...authHeader } },
        // No notification-stream reconnection by default
        // (`notification_stream_max_retries: 0`). The Streamable HTTP
        // transport maintains a standalone GET stream (SSE-encoded) for
        // server-initiated notifications and RESETS its retry counter
        // whenever a stream closes gracefully — hosted servers close idle
        // streams every few seconds, so under the SDK defaults every cached session
        // reconnects forever, and each attempt's fetch parks an abort
        // listener on the transport-lifetime signal until GC
        // (MaxListenersExceededWarning; issue #35). The delay values are
        // the SDK's own defaults — only the retry cap is configurable.
        reconnectionOptions: {
          maxRetries: httpConfig.notification_stream_max_retries,
          initialReconnectionDelay: 1000,
          reconnectionDelayGrowFactor: 1.5,
          maxReconnectionDelay: 30000,
        },
      };
      transport = new StreamableHTTPClientTransport(new URL(httpConfig.url), transportOptions);

    } else {
      throw new Error(`Unsupported MCP transport: '${(serverConfig as any).transport}'`);
    }

    // A close() that began during the async work above (the OAuth token
    // fetch is an await) must abort BEFORE a connection is dialed at all.
    if (this._activeDrains > 0 || this._closeGeneration !== closeGenerationAtStart) {
      throw new Error(`McpCommunicationProtocol was shut down while connecting '${sessionKey}'.`);
    }

    const mcpClient = new McpClient({ name: `utcp-mcp-client-${sessionKey}`, version: '1.0.1' });
    try {
      await mcpClient.connect(transport);
      if (this._activeDrains > 0 || this._closeGeneration !== closeGenerationAtStart) {
        // A close() intervened while we were connecting. Its sweep
        // snapshotted the cache before this session existed, so caching it
        // now would leave a live transport behind after that close returned.
        await mcpClient.close().catch(() => {});
        throw new Error(`McpCommunicationProtocol was shut down while connecting '${sessionKey}'.`);
      }
      this._mcpSessions.set(sessionKey, mcpClient);
    } catch (e: any) {
      // If connection fails, don't cache the broken client
      this._logError(`Failed to connect MCP client for '${sessionKey}':`, e.message);
      // Only hint when the child actually failed to start. A close() that
      // raced with this connect throws our own shutdown error above, and
      // that is not something stderr would explain.
      if (
        serverConfig.transport === 'stdio' &&
        process.env.UTCP_MCP_CHILD_STDERR !== 'inherit' &&
        this._activeDrains === 0 &&
        this._closeGeneration === closeGenerationAtStart
      ) {
        this._logError(
          `The child's stderr was suppressed. If startup output may explain this, re-run with ` +
          `UTCP_MCP_CHILD_STDERR=inherit to see what '${sessionKey}' printed while starting.`,
        );
      }
      throw e;
    }
    
    return mcpClient;
  }
  
  /**
   * Returns the configured timeout for an MCP server in milliseconds.
   * Defaults to 30 seconds when not specified.
   */
  private _getTimeoutMs(serverConfig: McpServerConfig): number {
    return (serverConfig.timeout ?? 30) * 1000;
  }

  /**
   * Classify an operation failure by what it says about the CACHED SESSION,
   * which is the thing `_withSession` is responsible for. Four answers:
   *
   *   - `'transient'` — the transport broke in a way a fresh dial has a real
   *     chance of fixing right now (connection dropped, reset, stale
   *     handshake). Evict and retry once.
   *   - `'auth'` — the server rejected the credential. Evict without
   *     retrying (a rejected credential does not heal by redialing with
   *     itself), and drop any cached OAuth token so the NEXT call fetches a
   *     fresh one instead of resending the rejected token until its local
   *     TTL runs out.
   *   - `'timeout'` — ours or the SDK's request-level timeout. The session
   *     is wedged with the request possibly still in flight; evict without
   *     retrying — closing the transport is also what aborts that request.
   *   - `null` — the error is about the OPERATION, not the session (a
   *     JSON-RPC tool error such as invalid params). The session is healthy;
   *     keep it.
   *
   * The auth class is what issue #34 was about: an auth failure never
   * matched the old transient allowlist, so the dead transport stayed cached
   * forever and every reuse parked one more abort listener on its
   * transport-lifetime signal — unbounded listener growth on a session that
   * could never succeed again.
   */
  private _classifySessionError(err: unknown): 'transient' | 'auth' | 'timeout' | null {
    // Structured metadata first; the message heuristics below are the
    // fallback for errors that arrive wrapped or stringified (and for SDK
    // copies that fail an instanceof across duplicated installs).
    if (err instanceof McpError) {
      // Two of the SDK's codes are raised CLIENT-side and describe the
      // transport, not a server response:
      //   - ConnectionClosed (-32000): the session dropped mid-request — the
      //     same condition the "closed" substring used to classify, so it
      //     stays transient (evict + one retry against a fresh dial).
      //   - RequestTimeout (-32001): the request never completed; the
      //     session is suspect, evict without retry.
      // Every OTHER McpError is a well-formed JSON-RPC response from a live
      // session — the transport works, whatever the error text says. Without
      // that gate, a tool error that merely mentions authorization
      // ("Authorization header missing for downstream API") would evict a
      // healthy session and throw away a valid OAuth token.
      //
      // -32000 needs one more discriminator: JSON-RPC reserves the
      // -32000..-32099 band for SERVER-defined errors, so a server can
      // legitimately answer a tool call with -32000 — and that response
      // arrives through a perfectly healthy session. The SDK's client-side
      // ConnectionClosed is always constructed with the fixed text
      // "Connection closed" (shared/protocol.js), while a server-relayed
      // error carries the server's own message — so require both. A server
      // that echoes the reserved code AND that exact phrase costs one
      // spurious evict-and-retry; accepted, since the alternative (bare
      // code) mis-evicts on every server-defined -32000.
      if (err.code === ErrorCode.ConnectionClosed && /\bconnection closed\b/i.test(err.message)) {
        return 'transient';
      }
      if (err.code === ErrorCode.RequestTimeout) return 'timeout';
      return null;
    }
    if (err instanceof StreamableHTTPError && (err.code === 401 || err.code === 403)) {
      return 'auth';
    }
    const msg = String((err as any)?.message ?? err).toLowerCase();
    // Auth-class rejections — checked FIRST: transports often wrap an auth
    // failure in connection vocabulary ("connection closed: 401
    // Unauthorized"), and letting the transient markers win would retry a
    // credential that cannot succeed. Matched loosely on purpose: transports
    // stringify these differently ("Error POSTing to endpoint (HTTP 401)",
    // "SSE error: 403 Forbidden", plain "Unauthorized"). A false positive
    // costs one eviction and redial; a false negative resurrects issue #34.
    if (/\b(?:http[ _-]?)?40[13]\b|unauthorized|forbidden|authentication|authorization|invalid[ _-]?token/.test(msg)) {
      return 'auth';
    }
    // Timeouts that leave the session suspect with the request possibly
    // still in flight: our own race ("timed out after Ns") and the MCP SDK's
    // request-level timeout (McpError -32001, "Request timed out") — the SDK
    // race usually fires first since we forward the same budget to it.
    // Neither pattern matches the network-level 'etimedout' (no space),
    // which stays transient below.
    if (msg.includes('timed out') || msg.includes('-32001')) {
      return 'timeout';
    }
    if (msg.includes('closed') || msg.includes('disconnected') ||
        msg.includes('econnreset') || msg.includes('etimedout') ||
        msg.includes('already initialized')) {
      return 'transient';
    }
    return null;
  }

  /**
   * Run `operation` bounded by the session's timeout. The timer is cleared
   * whichever side wins — the old inline race left a live timer behind for
   * the full timeout window on every successful call.
   */
  private async _runWithTimeout<T>(
    sessionKey: string,
    timeoutMs: number,
    client: McpClient,
    operation: (client: McpClient) => Promise<T>
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(client),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`MCP operation on '${sessionKey}' timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
        })
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async _withSession<T>(
    serverName: string,
    serverConfig: McpServerConfig,
    auth: Auth | undefined,
    operation: (client: McpClient) => Promise<T>
  ): Promise<T> {
    const sessionKey = `${serverName}:${serverConfig.transport}`;
    const timeoutMs = this._getTimeoutMs(serverConfig);
    // Hoisted so the catch arms can hand the SPECIFIC client that failed to
    // `_cleanupSession` — a key-only eviction would close whatever a
    // concurrent caller has cached under the key by then.
    let client: McpClient | undefined;
    try {
      client = await this._getOrCreateSession(serverName, serverConfig, auth);
      return await this._runWithTimeout(sessionKey, timeoutMs, client, operation);
    } catch (e: any) {
      this._logError(`MCP operation on '${sessionKey}' failed:`, e.message);

      const classification = this._classifySessionError(e);
      if (classification === 'transient') {
        this._logInfo(`Connection/initialization error detected on '${sessionKey}'. Cleaning up and retrying once...`);
        // `client` undefined means session CREATION failed — nothing of ours
        // was cached, and a key-only cleanup here could close a concurrent
        // caller's healthy session. Same guard on the arms below.
        if (client) await this._cleanupSession(sessionKey, client);
        let newClient: McpClient | undefined;
        try {
          newClient = await this._getOrCreateSession(serverName, serverConfig, auth);
          return await this._runWithTimeout(sessionKey, timeoutMs, newClient, operation);
        } catch (retryErr: any) {
          // The fresh session can be just as dead as the one it replaced
          // (server still down, credential still bad). Whatever the retry
          // cached must not outlive a session-class failure — leaving it is
          // exactly the accumulation vector of issue #34.
          const retryClassification = this._classifySessionError(retryErr);
          if (retryClassification !== null) {
            this._logInfo(`Retry on '${sessionKey}' failed with a session-class error. Evicting the retry's session.`);
            if (newClient) await this._cleanupSession(sessionKey, newClient);
          }
          if (retryClassification === 'auth') {
            this._invalidateOAuthToken(auth);
          }
          throw retryErr;
        }
      }
      if (classification === 'auth' || classification === 'timeout') {
        this._logInfo(`Session-fatal error on '${sessionKey}' (auth failure or operation timeout). Evicting so the next call dials fresh instead of reusing a dead transport.`);
        if (client) await this._cleanupSession(sessionKey, client);
        if (classification === 'auth') {
          this._invalidateOAuthToken(auth);
        }
      }

      throw e;
    }
  }

  public async registerManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<RegisterManualResult> {
    this._logInfo(`Registering MCP manual '${manualCallTemplate.name}' by discovering tools.`);
    const mcpCallTemplate = McpCallTemplateSchema.parse(manualCallTemplate);

    if (!mcpCallTemplate.config?.mcpServers || Object.keys(mcpCallTemplate.config.mcpServers).length === 0) {
      const errorMsg = "MCP call template has no servers configured.";
      this._logError(errorMsg);
      return { manualCallTemplate: mcpCallTemplate, manual: UtcpManualSchema.parse({ tools: [] }), success: false, errors: [errorMsg] };
    }

    const allTools: Tool[] = [];
    const allErrors: string[] = [];

    for (const [serverName, serverConfig] of Object.entries(mcpCallTemplate.config.mcpServers)) {
      try {
        this._logInfo(`Discovering tools from MCP server '${serverName}'...`);
        const requestTimeout = this._getTimeoutMs(serverConfig);
        const mcpToolsResult = await this._withSession(serverName, serverConfig, mcpCallTemplate.auth,
          (client) => client.listTools(undefined, { timeout: requestTimeout })
        );

        if (!isMcpToolsResponse(mcpToolsResult)) {
          throw new Error("Invalid response format from listTools");
        }

        // Dereference schemas to resolve $defs references (fixes FastMCP 2.0+ compatibility)
        const utcpToolsPromises = mcpToolsResult.tools.map(async (mcpTool: McpToolResponse) => {
          const [dereferencedInputs, dereferencedOutputs] = await Promise.all([
            this._dereferenceSchema(mcpTool.inputSchema),
            this._dereferenceSchema(mcpTool.outputSchema)
          ]);
          
          return {
            name: `${mcpCallTemplate.name}.${serverName}.${mcpTool.name}`,
            description: mcpTool.description || '',
            inputs: dereferencedInputs,
            outputs: dereferencedOutputs,
            tags: [],
            tool_call_template: mcpCallTemplate,
          };
        });
        
        const utcpTools = await Promise.all(utcpToolsPromises);
        allTools.push(...utcpTools);
        this._logInfo(`Discovered ${utcpTools.length} tools from server '${serverName}'.`);

      } catch (e: any) {
        this._logError(`Failed to discover tools from MCP server '${serverName}':`, e);
        allErrors.push(`Server '${serverName}': ${e.message}`);
      }
    }

    return {
      manualCallTemplate: mcpCallTemplate,
      manual: UtcpManualSchema.parse({ tools: allTools }),
      success: allErrors.length === 0,
      errors: allErrors,
    };
  }

  public async deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void> {
    const mcpCallTemplate = McpCallTemplateSchema.parse(manualCallTemplate);
    this._logInfo(`Deregistering MCP manual '${mcpCallTemplate.name}'.`);
    if (mcpCallTemplate.config?.mcpServers) {
      for (const serverName of Object.keys(mcpCallTemplate.config.mcpServers)) {
        await this._cleanupSession(`${serverName}:stdio`);
        await this._cleanupSession(`${serverName}:http`);
      }
    }
  }

  public async callTool(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): Promise<any> {
    const mcpCallTemplate = McpCallTemplateSchema.parse(toolCallTemplate);
    if (!mcpCallTemplate.config?.mcpServers) {
      throw new Error(`No MCP server configuration for tool '${toolName}'.`);
    }

    // Tool name format is: manualName.serverName.toolName
    // Strip the manual name prefix to get serverName.toolName
    const manualPrefix = `${mcpCallTemplate.name}.`;
    let toolNameWithoutManual = toolName;
    if (toolName.startsWith(manualPrefix)) {
      toolNameWithoutManual = toolName.substring(manualPrefix.length);
    }

    const [serverName, ...restOfToolName] = toolNameWithoutManual.split('.');
    const actualToolName = restOfToolName.join('.');

    if (!serverName || !actualToolName) {
      throw new Error(`Invalid MCP tool name format: '${toolName}'. Expected 'manualName.serverName.toolName'.`);
    }

    const serverConfig = mcpCallTemplate.config.mcpServers[serverName];
    if (!serverConfig) {
      throw new Error(`Configuration for MCP server '${serverName}' not found in manual '${mcpCallTemplate.name}'.`);
    }

    this._logInfo(`Calling tool '${actualToolName}' on MCP server '${serverName}'...`);
    const requestTimeout = this._getTimeoutMs(serverConfig);
    const result = await this._withSession(serverName, serverConfig, mcpCallTemplate.auth,
      (client) => client.callTool({ name: actualToolName, arguments: toolArgs }, undefined, { timeout: requestTimeout })
    );

    return this._processMcpToolResult(result);
  }

  public async *callToolStreaming(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): AsyncGenerator<any, void, unknown> {
    this._logInfo(`MCP protocol does not support streaming for '${toolName}'. Fetching full response as a single chunk.`);
    const result = await this.callTool(caller, toolName, toolArgs, toolCallTemplate);
    yield result;
  }

  public async close(): Promise<void> {
    this._logInfo("Closing all active MCP sessions.");
    this._activeDrains += 1;
    this._closeGeneration += 1;
    try {
      const cleanupPromises = Array.from(this._mcpSessions.keys()).map(key => this._cleanupSession(key));
      await Promise.all(cleanupPromises);
      this._oauthTokens.clear();
      // Drop references to any in-flight fetches; they self-remove on settle,
      // and JS promises can't be cancelled, so this only avoids a brief dangling
      // entry after a drain.
      this._oauthInflight.clear();
    } finally {
      // Drain complete — the shared registry instance stays usable. This
      // instance serves every UtcpClient in the process (see the field
      // docs), so staying closed would take MCP away from all of them.
      // Decrement, not reset: an overlapping close() that finished faster
      // must not reopen the gate while this sweep is still closing
      // transports.
      this._activeDrains -= 1;
    }
    this._logInfo("MCP Communication Protocol drained all sessions and cleaned up.");
  }
  
  private _processMcpToolResult(result: any): any {
    if (result && typeof result === 'object') {
      // Prefer `structuredContent` (MCP spec field) whenever the server sent
      // it. Spec-compliant servers also mirror it as a serialized text block
      // in `content` for older clients, and re-parsing that text is lossy: a
      // numeric-looking string becomes a number, unparsable JSON stays a
      // string. Using the structured payload directly also covers servers
      // that return an empty `content` array with only `structuredContent`,
      // which previously collapsed to []. Matches the Python SDK.
      if (result.structuredContent != null) {
        return this._unwrapStructuredContent(result.structuredContent);
      }
      // Legacy, non-standard field this client accepted before 1.2; kept so a
      // server relying on it does not silently regress.
      if (result.structured_output != null) {
        return result.structured_output;
      }
      if (Array.isArray(result.content)) {
        const processedList = result.content.map((item: any) => {
          if (item && item.type === 'text' && typeof item.text === 'string') {
            return this._parseTextContent(item.text);
          }
          return item;
        });
        return processedList.length === 1 ? processedList[0] : processedList;
      }
    }
    return result;
  }

  /**
   * FastMCP-style servers wrap NON-OBJECT tool returns (primitives, arrays,
   * null) as `{ result: value }` so that `structuredContent` is always an
   * object; object returns are sent as-is. Unwrap exactly that shape: a
   * single `result` key whose value is not a plain object. A single-key
   * `{ result: { ... } }` is therefore a genuine object return and passes
   * through untouched, as does any object with other keys. A genuine
   * `{ result: <primitive or array> }` return is indistinguishable from the
   * wrapper on the wire and is unwrapped too; that ambiguity is inherent to
   * the FastMCP convention.
   */
  private _unwrapStructuredContent(structured: any): any {
    if (
      structured &&
      typeof structured === 'object' &&
      !Array.isArray(structured) &&
      Object.keys(structured).length === 1 &&
      'result' in structured
    ) {
      const inner = structured.result;
      const innerIsPlainObject = inner !== null && typeof inner === 'object' && !Array.isArray(inner);
      if (!innerIsPlainObject) {
        return inner;
      }
    }
    return structured;
  }

  private _parseTextContent(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      const num = Number(text);
      if (!isNaN(num) && isFinite(num)) {
        return num;
      }
      return text;
    }
  }
  
  private async _handleOAuth2(authDetails: OAuth2Auth): Promise<string> {
    // Validate the token endpoint before sending credentials to it, so a
    // manual cannot direct the operator's client secret at an arbitrary host.
    // Validation covers only this URL, so the credential-bearing POSTs below
    // disable redirects (maxRedirects: 0) — a 307/308 would otherwise let axios
    // replay the client secret to an unvalidated redirect target.
    ensureSecureMcpUrl(authDetails.token_url, 'MCP OAuth2 token URL');
    const clientId = authDetails.client_id;
    const cachedToken = this._oauthTokens.get(clientId);
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.accessToken;
    }

    // Coalesce concurrent first-time fetches: share one in-flight request per
    // client so a burst of callers issues a single token request. The
    // check-and-set is synchronous, so exactly one fetch is started.
    let inflight = this._oauthInflight.get(clientId);
    if (!inflight) {
      inflight = this._fetchOAuth2Token(authDetails);
      this._oauthInflight.set(clientId, inflight);
      // Clear the slot once settled so a later miss re-fetches. The handler
      // never rethrows, so it does not create an unhandled rejection; callers
      // still observe the original promise's rejection via `await inflight`.
      const forget = () => {
        if (this._oauthInflight.get(clientId) === inflight) {
          this._oauthInflight.delete(clientId);
        }
      };
      inflight.then(forget, forget);
    }
    const token = await inflight;
    return token.accessToken;
  }

  private async _fetchOAuth2Token(authDetails: OAuth2Auth): Promise<{ accessToken: string; expiresAt: number }> {
    const clientId = authDetails.client_id;
    this._logInfo(`Fetching new OAuth2 token for client: '${clientId}'`);
    const generation = this._oauthGeneration(clientId);

    try {
      // Only the WINNER of the race caches — previously each variant wrote
      // the cache on its own success, so the slower one landed later and
      // overwrote whatever was there, including an invalidation that
      // happened in between. And even the winner only caches if nothing
      // invalidated this client while the fetch was in flight.
      const token = await Promise.any([
        (async () => {
          const bodyData = new URLSearchParams({
            'grant_type': 'client_credentials', 'client_id': authDetails.client_id,
            'client_secret': authDetails.client_secret, 'scope': authDetails.scope || ''
          });
          const response = await this._axiosInstance.post(authDetails.token_url, bodyData.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 });
          if (!response.data.access_token) throw new Error("Access token not found in response.");
          const expiresAt = Date.now() + ((response.data.expires_in || 3600) * 1000);
          return { accessToken: response.data.access_token as string, expiresAt };
        })(),
        (async () => {
          const bodyData = new URLSearchParams({ 'grant_type': 'client_credentials', 'scope': authDetails.scope || '' });
          const response = await this._axiosInstance.post(authDetails.token_url, bodyData.toString(), {
            auth: { username: authDetails.client_id, password: authDetails.client_secret },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            maxRedirects: 0
          });
          if (!response.data.access_token) throw new Error("Access token not found in response.");
          const expiresAt = Date.now() + ((response.data.expires_in || 3600) * 1000);
          return { accessToken: response.data.access_token as string, expiresAt };
        })()
      ]);
      if (this._oauthGeneration(clientId) === generation) {
        this._oauthTokens.set(clientId, token);
      } else {
        this._logInfo(`OAuth token for client '${clientId}' was invalidated while a fetch was in flight; not caching the stale result.`);
      }
      return token;
    } catch (aggregateError: any) {
      const errorMessages = aggregateError.errors?.map((e: Error) => e.message).join('; ') || String(aggregateError);
      throw new Error(`Failed to fetch OAuth2 token for client '${clientId}': ${errorMessages}`);
    }
  }
}