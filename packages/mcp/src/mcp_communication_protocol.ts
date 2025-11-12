// packages/mcp/src/mcp_communication_protocol.ts
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport, StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import axios, { AxiosInstance } from 'axios';
import { CommunicationProtocol } from '@utcp/sdk';
import { RegisterManualResult } from '@utcp/sdk';
import { CallTemplate } from '@utcp/sdk';
import { UtcpManualSchema } from '@utcp/sdk';
import { Tool, JsonSchema } from '@utcp/sdk';
import { OAuth2Auth } from '@utcp/sdk';
import { IUtcpClient } from '@utcp/sdk'; 
import { McpCallTemplateSchema, McpHttpServer, McpServerConfig, McpStdioServer } from './mcp_call_template';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

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
  private _axiosInstance: AxiosInstance;
  private _mcpSessions: Map<string, McpClient> = new Map();

  constructor() {
    this._axiosInstance = axios.create({ timeout: 30000 });
  }

  private _logInfo(message: string): void {
    console.log(`[McpCommunicationProtocol] ${message}`);
  }

  private _logError(message: string, error?: any): void {
    console.error(`[McpCommunicationProtocol Error] ${message}`, error);
  }

  private async _cleanupSession(sessionKey: string): Promise<void> {
    const session = this._mcpSessions.get(sessionKey);
    if (session) {
      try {
        await session.close();
        this._logInfo(`Closed MCP session for '${sessionKey}'.`);
      } catch (e: any) {
        this._logError(`Error closing session for '${sessionKey}':`, e.message);
      } finally {
        this._mcpSessions.delete(sessionKey);
      }
    }
  }

  private async _getOrCreateSession(
    serverName: string,
    serverConfig: McpServerConfig,
    auth?: OAuth2Auth
  ): Promise<McpClient> {
    const sessionKey = `${serverName}:${serverConfig.transport}`;

    // Check if we have an existing session
    if (this._mcpSessions.has(sessionKey)) {
      const existingSession = this._mcpSessions.get(sessionKey)!;
      this._logInfo(`Reusing existing MCP session for '${sessionKey}'.`);
      return existingSession;
    }

    this._logInfo(`Creating new MCP session for '${sessionKey}'...`);
    let transport: Transport;

    if (serverConfig.transport === 'stdio') {
      const stdioConfig = serverConfig as McpStdioServer;
      const isWindows = process.platform === "win32";
      const commandString = [stdioConfig.command, ...(stdioConfig.args || [])]
        .map(part => part.includes(' ') ? `"${part}"` : part)
        .join(' ');

      const combinedEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ...(stdioConfig.env || {}),
      };

      transport = new StdioClientTransport({
        command: isWindows ? 'cmd.exe' : 'sh',
        args: isWindows ? ['/c', commandString] : ['-c', commandString],
        cwd: stdioConfig.cwd,
        env: combinedEnv,
      });

    } else if (serverConfig.transport === 'http') {
      const httpConfig = serverConfig as McpHttpServer;
      let authHeader: Record<string, string> = {};
      if (auth) {
        const token = await this._handleOAuth2(auth);
        authHeader['Authorization'] = `Bearer ${token}`;
      }

      const transportOptions: StreamableHTTPClientTransportOptions = {
        requestInit: { headers: { ...(httpConfig.headers || {}), ...authHeader } }
      };
      transport = new StreamableHTTPClientTransport(new URL(httpConfig.url), transportOptions);

    } else {
      throw new Error(`Unsupported MCP transport: '${(serverConfig as any).transport}'`);
    }

    const mcpClient = new McpClient({ name: `utcp-mcp-client-${sessionKey}`, version: '1.0.1' });
    try {
      await mcpClient.connect(transport);
      this._mcpSessions.set(sessionKey, mcpClient);
    } catch (e: any) {
      // If connection fails, don't cache the broken client
      this._logError(`Failed to connect MCP client for '${sessionKey}':`, e.message);
      throw e;
    }
    
    return mcpClient;
  }
  
  private async _withSession<T>(
    serverName: string,
    serverConfig: McpServerConfig,
    auth: OAuth2Auth | undefined,
    operation: (client: McpClient) => Promise<T>
  ): Promise<T> {
    const sessionKey = `${serverName}:${serverConfig.transport}`;
    try {
      const client = await this._getOrCreateSession(serverName, serverConfig, auth);
      return await Promise.race([
        operation(client),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`MCP operation on '${sessionKey}' timed out after 15s.`)), 15000))
      ]);
    } catch (e: any) {
      this._logError(`MCP operation on '${sessionKey}' failed:`, e.message);
      
      const errorMsg = String((e as any)?.message ?? e).toLowerCase();
      // Check for connection errors or "already initialized" errors
      if (errorMsg.includes('closed') || errorMsg.includes('disconnected') || 
          errorMsg.includes('econnreset') || errorMsg.includes('etimedout') ||
          errorMsg.includes('already initialized')) {
        this._logInfo(`Connection/initialization error detected on '${sessionKey}'. Cleaning up and retrying once...`);
        await this._cleanupSession(sessionKey);
        const newClient = await this._getOrCreateSession(serverName, serverConfig, auth);
        return await Promise.race([operation(newClient), new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`MCP operation on '${sessionKey}' timed out after 15s.`)), 15000))]);
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
        const mcpToolsResult = await this._withSession(serverName, serverConfig, mcpCallTemplate.auth,
          (client) => client.listTools()
        );

        if (!isMcpToolsResponse(mcpToolsResult)) {
          throw new Error("Invalid response format from listTools");
        }

        const utcpTools = mcpToolsResult.tools.map((mcpTool: McpToolResponse) => {
          return {
            name: `${mcpCallTemplate.name}.${serverName}.${mcpTool.name}`,
            description: mcpTool.description || '',
            inputs: mcpTool.inputSchema as JsonSchema,
            outputs: mcpTool.outputSchema as JsonSchema,
            tags: [],
            tool_call_template: mcpCallTemplate,
          };
        });
        
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
    const result = await this._withSession(serverName, serverConfig, mcpCallTemplate.auth,
      (client) => client.callTool({ name: actualToolName, arguments: toolArgs })
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
    const cleanupPromises = Array.from(this._mcpSessions.keys()).map(key => this._cleanupSession(key));
    await Promise.all(cleanupPromises);
    this._oauthTokens.clear();
    this._logInfo("MCP Communication Protocol closed and all resources cleaned up.");
  }
  
  private _processMcpToolResult(result: any): any {
    if (result && typeof result === 'object') {
      if ('structured_output' in result) {
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
    const clientId = authDetails.client_id;
    const cachedToken = this._oauthTokens.get(clientId);
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.accessToken;
    }

    this._logInfo(`Fetching new OAuth2 token for client: '${clientId}'`);

    try {
      const token = await Promise.any([
        (async () => {
          const bodyData = new URLSearchParams({
            'grant_type': 'client_credentials', 'client_id': authDetails.client_id,
            'client_secret': authDetails.client_secret, 'scope': authDetails.scope || ''
          });
          const response = await this._axiosInstance.post(authDetails.token_url, bodyData.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
          if (!response.data.access_token) throw new Error("Access token not found in response.");
          const expiresAt = Date.now() + ((response.data.expires_in || 3600) * 1000);
          this._oauthTokens.set(clientId, { accessToken: response.data.access_token, expiresAt });
          return response.data.access_token;
        })(),
        (async () => {
          const bodyData = new URLSearchParams({ 'grant_type': 'client_credentials', 'scope': authDetails.scope || '' });
          const response = await this._axiosInstance.post(authDetails.token_url, bodyData.toString(), {
            auth: { username: authDetails.client_id, password: authDetails.client_secret },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
          if (!response.data.access_token) throw new Error("Access token not found in response.");
          const expiresAt = Date.now() + ((response.data.expires_in || 3600) * 1000);
          this._oauthTokens.set(clientId, { accessToken: response.data.access_token, expiresAt });
          return response.data.access_token;
        })()
      ]);
      return token;
    } catch (aggregateError: any) {
      const errorMessages = aggregateError.errors?.map((e: Error) => e.message).join('; ') || String(aggregateError);
      throw new Error(`Failed to fetch OAuth2 token for client '${clientId}': ${errorMessages}`);
    }
  }
}