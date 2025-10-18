# @utcp/mcp: Model Context Protocol (MCP) Communication Protocol Plugin for UTCP

The `@utcp/mcp` package enables the `UtcpClient` to interact with tools defined and served via the Model Context Protocol (MCP). This plugin provides interoperability with existing MCP servers, supporting both `stdio` (local process) and `http` (streamable HTTP) transports, now with enhanced session management and resilience.

## Features

*   **MCP `CallTemplate`**: Defines the configuration for connecting to one or more MCP servers (`McpCallTemplate`), including transport type (`stdio` or `http`) and optional OAuth2 authentication for HTTP-based servers.
*   **`McpCommunicationProtocol`**: Implements the `CommunicationProtocol` interface for MCP interactions:
    *   **Persistent Session Management**: Establishes and reuses client sessions with MCP servers (via subprocess for stdio, or HTTP client for remote), drastically improving performance and reducing overhead for repeated tool calls.
    *   **Automatic Session Recovery**: Intelligently detects and recovers from transient connection issues (e.g., network errors, broken pipes, crashed subprocesses) by automatically re-establishing sessions and retrying operations.
    *   **Tool Discovery**: Connects to configured MCP servers and retrieves their list of tools using the MCP SDK's `listTools()` command, mapping them to UTCP `Tool` definitions.
    *   **Tool Execution**: Invokes tools on MCP servers using the MCP SDK's `callTool()`, translating arguments and processing raw MCP results into a unified format.
    *   **Transport Support**: Seamlessly handles both `stdio` (spawning a local process) and `http` (connecting to a remote streamable HTTP MCP server) via the `@modelcontextprotocol/sdk` client.
    *   **Authentication Support**: Supports `OAuth2Auth` for HTTP-based MCP servers, including token caching and refresh.
    *   **Result Processing**: Adapts raw MCP tool results (which can contain `structured_output`, `text` content, or `json` content) into a more usable format for the UTCP client.

## Installation

```bash
bun add @utcp/mcp @utcp/core @modelcontextprotocol/sdk axios
```

Note: `@utcp/core` is a peer dependency, and `@modelcontextprotocol/sdk` and `axios` are direct dependencies.

## Usage

To use the MCP plugin, you must register its capabilities with the core `UtcpClient` at application startup. This is typically done by calling the `registerMcpPlugin()` function exported from `@utcp/mcp`.

```typescript
// From your application's entry point

import { UtcpClient } from '@utcp/core/client/utcp_client';
import { UtcpClientConfigSchema } from '@utcp/core/client/utcp_client_config';
import { McpCallTemplateSchema } from '@utcp/mcp/mcp_call_template';
import { registerMcpPlugin } from '@utcp/mcp'; // Import the registration function
import * as path from 'path';

// --- IMPORTANT: Register the MCP plugin once at the start of your application ---
registerMcpPlugin();
// -------------------------------------------------------------------------------

async function main() {
  // Path to your mock MCP server script (e.g., from tests/mock_mcp_server.ts)
  const mockMcpStdioServerPath = path.resolve(__dirname, '../../packages/mcp/tests/mock_mcp_server.ts');
  const mockMcpHttpServerPath = path.resolve(__dirname, '../../packages/mcp/tests/mock_http_mcp_server.ts');

  // Define a CallTemplate to connect to an MCP server running via stdio (local subprocess)
  const mcpCallTemplate = McpCallTemplateSchema.parse({
    name: 'my_mcp_servers', // A single manual can manage multiple MCP servers
    call_template_type: 'mcp',
    config: {
      mcpServers: {
        'local-stdio-server': { // Name for your stdio server
          transport: 'stdio',
          command: 'bun', // Command to run the server script
          args: ['run', mockMcpStdioServerPath], // Arguments to the command
          cwd: path.dirname(mockMcpStdioServerPath), // Optional: working directory for the subprocess
        },
        'remote-http-server': { // Name for your HTTP server
          transport: 'http',
          url: 'http://localhost:9999/mcp', // URL of your mock_http_mcp_server
        },
        // Example with OAuth2 (uncomment and configure if needed)
        // 'secure-http-server': {
        //   transport: 'http',
        //   url: 'https://secure.mcp.example.com/mcp',
        // },
      },
    },
    // Top-level auth applies to HTTP transports if specified.
    // auth: { auth_type: 'oauth2', token_url: '...', client_id: '${SECURE_MCP_CLIENT_ID}', client_secret: '${SECURE_MCP_CLIENT_SECRET}' }
  });

  const client = await UtcpClient.create(
    UtcpClientConfigSchema.parse({
      manual_call_templates: [mcpCallTemplate], // Register the MCP manual at client startup
      variables: {
        // SECURE_MCP_CLIENT_ID: 'your-client-id',
        // SECURE_MCP_CLIENT_SECRET: 'your-client-secret'
      }
    })
  );

  console.log('MCP Plugin active. Discovering tools...');

  // Example: Search for tools on the MCP server
  const stdioTools = await client.searchTools('stdio'); // Will find tools prefixed with 'local-stdio-server'
  console.log('Found MCP (stdio) tools:', stdioTools.map(t => t.name));

  const httpTools = await client.searchTools('http'); // Will find tools prefixed with 'remote-http-server'
  console.log('Found MCP (http) tools:', httpTools.map(t => t.name));

  // Example: Call a 'echo' tool on the stdio server (expecting structured JSON)
  try {
    const echoResult = await client.callTool('my_mcp_servers.local-stdio-server.echo', { message: 'Hello from stdio!' });
    console.log('MCP stdio echo tool result:', echoResult);
  } catch (error) {
    console.error('Error calling MCP stdio echo tool:', error);
  }

  // Example: Call an 'add' tool on the http server (expecting a primitive number)
  try {
    const addResult = await client.callTool('my_mcp_servers.remote-http-server.add', { a: 10, b: 20 });
    console.log('MCP http add tool result:', addResult);
  } catch (error) {
    console.error('Error calling MCP http add tool:', error);
  }

  await client.close(); // Important: Cleans up all active MCP client sessions and subprocesses
}

main().catch(console.error);