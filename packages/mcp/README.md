# @utcp/mcp: Model Context Protocol (MCP) Communication Protocol Plugin for UTCP

The `@utcp/mcp` package enables the `UtcpClient` to interact with tools defined and served via the Model Context Protocol (MCP). This plugin provides interoperability with existing MCP servers, supporting both `stdio` (local process) and `http` (streamable HTTP) transports, with enhanced session management and resilience.

## Features

*   **Automatic Plugin Registration**: Registers automatically when imported—no manual setup required.
*   **FastMCP 2.0+ Compatibility**: Automatically resolves JSON Schema `$defs` references, ensuring compatibility with modern MCP servers built on FastMCP 2.0+.
*   **MCP `CallTemplate`**: Defines the configuration for connecting to one or more MCP servers (`McpCallTemplate`), including:
    *   Transport type (`stdio` or `http`)
    *   Optional OAuth2 authentication for HTTP-based servers
    *   `register_resources_as_tools`: Flag to expose MCP server resources as callable tools
    *   Environment variables support for stdio servers
*   **`McpCommunicationProtocol`**: Implements the `CommunicationProtocol` interface for MCP interactions:
    *   **Persistent Session Management**: Establishes and reuses client sessions with MCP servers (via subprocess for stdio, or HTTP client for remote), drastically improving performance and reducing overhead for repeated tool calls.
    *   **Automatic Session Recovery**: Intelligently detects and recovers from transient connection issues (e.g., network errors, broken pipes, crashed subprocesses) by automatically re-establishing sessions and retrying operations.
    *   **Tool Discovery**: Connects to configured MCP servers and retrieves their list of tools using the MCP SDK's `listTools()` command, mapping them to UTCP `Tool` definitions.
    *   **Tool Execution**: Invokes tools on MCP servers using the MCP SDK's `callTool()`, translating arguments and processing raw MCP results into a unified format.
    *   **Transport Support**: Seamlessly handles both `stdio` (spawning a local process) and `http` (connecting to a remote streamable HTTP MCP server) via the `@modelcontextprotocol/sdk` client.
    *   **Authentication Support**: Supports `OAuth2Auth` for HTTP-based MCP servers, including token caching and automatic refresh.
    *   **Result Processing**: Intelligently adapts raw MCP tool results (which can contain `structured_output`, `text` content, or `json` content) into a more usable format for the UTCP client.

## Installation

```bash
bun add @utcp/mcp @utcp/sdk

# Or using npm
npm install @utcp/mcp @utcp/sdk
```

Note: `@utcp/sdk` is a peer dependency. The MCP SDK dependencies (`@modelcontextprotocol/sdk` and `axios`) are included automatically.

## Usage

The MCP plugin registers automatically when you import it—no manual registration needed. Simply import from `@utcp/mcp` to enable MCP support.

```typescript
// From your application's entry point

import { UtcpClient } from '@utcp/sdk';
import { McpCallTemplateSerializer } from '@utcp/mcp';
import * as path from 'path';

async function main() {
  // Path to your mock MCP server script (e.g., from tests/mock_mcp_server.ts)
  const mockMcpStdioServerPath = path.resolve(__dirname, '../../packages/mcp/tests/mock_mcp_server.ts');
  const mockMcpHttpServerPath = path.resolve(__dirname, '../../packages/mcp/tests/mock_http_mcp_server.ts');

  // Define a CallTemplate to connect to MCP servers
  const serializer = new McpCallTemplateSerializer();
  const mcpCallTemplate = serializer.validateDict({
    name: 'my_mcp_servers', // A single manual can manage multiple MCP servers
    call_template_type: 'mcp',
    config: {
      mcpServers: {
        'local-stdio-server': { // Name for your stdio server
          transport: 'stdio',
          command: 'bun', // Command to run the server script
          args: ['run', mockMcpStdioServerPath], // Arguments to the command
          cwd: path.dirname(mockMcpStdioServerPath), // Optional: working directory for the subprocess
          env: { // Optional: environment variables for the subprocess
            MY_ENV_VAR: 'value',
            API_KEY: '${MY_API_KEY}' // Can use variable substitution
          }
        },
        'remote-http-server': { // Name for your HTTP server
          transport: 'http',
          url: 'http://localhost:9999/mcp', // URL of your MCP HTTP server
          headers: { // Optional: custom HTTP headers
            'X-Custom-Header': 'value'
          },
          timeout: 30, // Optional: HTTP request timeout in seconds (default: 30)
          sse_read_timeout: 300, // Optional: SSE read timeout in seconds (default: 300)
          terminate_on_close: true // Optional: terminate connection on close (default: true)
        },
        // Example with OAuth2 (uncomment and configure if needed)
        // 'secure-http-server': {
        //   transport: 'http',
        //   url: 'https://secure.mcp.example.com/mcp',
        // },
      },
    },
    // Top-level auth applies to HTTP transports if specified.
    // auth: { auth_type: 'oauth2', token_url: '...', client_id: '${SECURE_MCP_CLIENT_ID}', client_secret: '${SECURE_MCP_CLIENT_SECRET}' },
    
    // Optional: Register MCP resources as callable tools (default: false)
    register_resources_as_tools: false
  });

  const client = await UtcpClient.create(process.cwd(), {
    manual_call_templates: [mcpCallTemplate], // Register the MCP manual at client startup
    variables: {
      my__mcp__servers_MY_API_KEY: 'your-api-key-value', // Namespaced variable
      // my__mcp__servers_SECURE_MCP_CLIENT_ID: 'your-client-id',
      // my__mcp__servers_SECURE_MCP_CLIENT_SECRET: 'your-client-secret'
    }
  });

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
```

## Advanced Configuration

### Environment Variables for Stdio Servers

You can pass environment variables to stdio-based MCP servers using the `env` field. These support UTCP variable substitution:

```typescript
{
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  env: {
    API_KEY: '${MY_API_KEY}',  // Will resolve from namespaced variable
    LOG_LEVEL: 'debug',
    NODE_ENV: 'production'
  }
}

// When creating the client, use namespaced variables:
const client = await UtcpClient.create(process.cwd(), {
  manual_call_templates: [mcpTemplate],
  variables: {
    my__manual__name_MY_API_KEY: 'your-api-key'  // Note: manual_name -> my__manual__name_
  }
});
```

### HTTP Server Configuration

HTTP-based MCP servers support additional configuration options:

```typescript
{
  transport: 'http',
  url: 'https://mcp-server.example.com/mcp',
  headers: {
    'X-Custom-Header': 'value',
    'User-Agent': 'MyApp/1.0'
  },
  timeout: 60,              // Request timeout in seconds
  sse_read_timeout: 600,    // SSE read timeout in seconds
  terminate_on_close: true  // Terminate connection when client closes
}
```

### OAuth2 Authentication

For HTTP servers requiring authentication, use the top-level `auth` field:

```typescript
const serializer = new McpCallTemplateSerializer();
const secureTemplate = serializer.validateDict({
  name: 'secure_mcp_servers',
  call_template_type: 'mcp',
  config: { /* ... */ },
  auth: {
    auth_type: 'oauth2',
    token_url: 'https://auth.example.com/oauth/token',
    client_id: '${MCP_CLIENT_ID}',
    client_secret: '${MCP_CLIENT_SECRET}',
    scope: 'mcp.tools.read mcp.tools.execute'
  }
});

// Configure client with namespaced variables
const client = await UtcpClient.create(process.cwd(), {
  manual_call_templates: [secureTemplate],
  variables: {
    secure__mcp__servers_MCP_CLIENT_ID: 'your-client-id',
    secure__mcp__servers_MCP_CLIENT_SECRET: 'your-client-secret'
  }
});
```

The plugin automatically handles token caching and refresh.

### Resource Registration

MCP servers can expose resources (files, data sources, etc.) alongside tools. To register these resources as callable tools, set `register_resources_as_tools` to `true`:

```typescript
{
  name: 'my_mcp_servers',
  call_template_type: 'mcp',
  config: { /* ... */ },
  register_resources_as_tools: true  // Exposes server resources as tools
}
```

## FastMCP Compatibility

Starting with version 1.0.17, this plugin automatically handles JSON Schema `$defs` references used by FastMCP 2.0+ servers. This resolves the issue where tool discovery would fail with:

```
MissingRefError: can't resolve reference #/$defs/...
```

**How it works:**
- When tools are discovered from MCP servers, their input and output schemas are automatically dereferenced
- `$defs` references are resolved and inlined into the schema
- This process is transparent and requires no configuration changes
- If dereferencing fails for any reason, the original schema is used as a fallback

This ensures seamless integration with:
- `basic-memory` and other FastMCP-based servers
- Any MCP server using modern JSON Schema draft-2020-12 features
- Legacy MCP servers (which continue to work as before)

## Tool Naming Convention

Tools discovered from MCP servers follow the naming pattern:

```
{manual_name}.{server_name}.{tool_name}
```

For example:
- Manual name: `my_mcp_servers`
- Server name: `local-stdio-server`
- Tool name: `echo`
- **Full tool name**: `my_mcp_servers.local-stdio-server.echo`

## Session Management

The MCP plugin maintains persistent sessions with each configured server:

- **Session Reuse**: Connections are established once and reused for multiple tool calls, significantly improving performance.
- **Automatic Recovery**: If a session fails (network error, subprocess crash, etc.), the plugin automatically:
  1. Detects the failure
  2. Cleans up the broken session
  3. Establishes a new session
  4. Retries the operation once

This resilience mechanism handles common transient issues without requiring manual intervention.

## Error Handling

The plugin provides comprehensive error handling:

- Connection failures are logged and retried once
- Invalid tool names produce descriptive error messages
- OAuth2 token fetch failures include detailed error context
- MCP server errors are properly propagated to the caller

## API Reference

### McpCallTemplate

```typescript
interface McpCallTemplate {
  name?: string;
  call_template_type: 'mcp';
  config: McpConfig;
  auth?: OAuth2Auth;
  register_resources_as_tools?: boolean;
}
```

### McpStdioServer

```typescript
interface McpStdioServer {
  transport: 'stdio';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}
```

### McpHttpServer

```typescript
interface McpHttpServer {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
  timeout?: number;              // Default: 30 seconds
  sse_read_timeout?: number;     // Default: 300 seconds
  terminate_on_close?: boolean;  // Default: true
}
```

## Best Practices

1. **Close clients properly**: Always call `await client.close()` to clean up MCP sessions and subprocesses.
2. **Use variable substitution**: Store sensitive credentials in environment variables and reference them with `${VAR_NAME}`.
3. **Configure timeouts**: Adjust `timeout` and `sse_read_timeout` based on your server's response characteristics.
4. **Server naming**: Use descriptive server names as they become part of the tool naming hierarchy.
5. **Error handling**: Wrap tool calls in try-catch blocks for robust error handling.

## License

This package is part of the UTCP project. See the main repository for license information.