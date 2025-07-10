# Universal Tool Calling Protocol (UTCP) for TypeScript

[![NPM version](https://img.shields.io/npm/v/@utcp/sdk.svg)](https://www.npmjs.com/package/@utcp/sdk)

## Introduction

The Universal Tool Calling Protocol (UTCP) is a modern, flexible, and scalable standard for defining and interacting with tools across a wide variety of communication protocols. This library is the official TypeScript implementation, designed to be easy to use, interoperable, and extensible.

In contrast to other protocols, UTCP places a strong emphasis on:

*   **Scalability**: UTCP is designed to handle a large number of tools and providers without compromising performance.
*   **Interoperability**: With support for a wide range of provider types (including HTTP, WebSockets, SSE, and even CLI tools), UTCP can integrate with almost any existing service or infrastructure.
*   **Type Safety**: The protocol is built on simple, well-defined TypeScript interfaces with runtime validation powered by Zod, making it robust and easy for developers to use.

## Usage Examples

These examples illustrate the core concepts of the UTCP client and server. They are not designed to be a single, runnable example.

> **Note:** For complete, end-to-end runnable examples, please refer to the `examples/` directory in this repository.

### 1. Using the UTCP Client

Setting up a client is simple. You point it to a `providers.json` file, and it handles the rest.

**`providers.json`**

This file tells the client where to find one or more UTCP Manuals (providers which return a list of tools).

```json
[
  {
    "name": "example_server",
    "provider_type": "http",
    "url": "http://localhost:8080/utcp",
    "http_method": "GET"
  }
]
```

**`client.ts`**

This script initializes the client and calls a tool from the provider defined above.

```typescript
import { UtcpClient } from './src/client/utcp-client';

async function main() {
  console.log('Initializing UTCP client...');

  const client = await UtcpClient.create({
    providers_file_path: './providers.json',
  });

  const tools = await client.toolRepository.getTools();

  if (tools.length === 0) {
    console.log('No tools found. Make sure the example server is running.');
    return;
  }

  console.log('Registered tools:');
  for (const tool of tools) {
    console.log(` - ${tool.name}`);
  }

  // Call the first available tool
  const toolToCall = tools[0]!;
  const args = {
    body: { value: 'hello from the client!' },
  };

  console.log(`\nCalling tool: '${toolToCall.name}'...`);
  try {
    const result = await client.call_tool(toolToCall.name, args);
    console.log('Tool call result:');
    console.log(result);
  } catch (error) {
    console.error('Error calling tool:', error);
  }
}

main().catch(error => {
  console.error('An unexpected error occurred:', error);
});
```

### 2. Providing a UTCP Manual

Any type of server or service can be exposed as a UTCP tool. The only requirement is that a `UtcpManual` is provided to the client. This manual can be served by the tool itself or, more powerfully, by a third-party registry. This allows for wrapping existing APIs and services that are not natively UTCP-aware.

Here is a minimal example using Express to serve a `UTCPManual` for a tool:

**`server.ts`**
```typescript
import express from 'express';
import { HttpProvider } from './src/shared/provider';
import { Tool } from './src/shared/tool';
import { UtcpManual } from './src/shared/utcp-manual';

const app = express();
app.use(express.json());

const PORT = 8080;
const __version__ = '0.1.0';
const BASE_PATH = `http://localhost:${PORT}`;

// Manually define the tool
const testTool: Tool = {
  name: 'test_endpoint',
  description: 'A simple test endpoint that echoes a value.',
  tags: ['test', 'example'],
  tool_provider: {
    name: 'test_provider',
    provider_type: 'http',
    url: `${BASE_PATH}/test`,
    http_method: 'POST',
  } as HttpProvider,
  inputs: {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'A string value to be echoed back.' },
    },
    required: ['value'],
  },
  outputs: {
    type: 'object',
    properties: {
      received: { type: 'string', description: 'The value that was received by the tool.' },
    },
    required: ['received'],
  },
};

// Manually construct the UTCP manual
const manual: UtcpManual = {
  version: __version__,
  tools: [testTool],
};

// Endpoint to serve the UTCP manual
app.get('/utcp', (req, res) => {
  res.json(manual);
});

// The actual tool endpoint
app.post('/test', (req, res) => {
  const { value } = req.body;

  if (typeof value !== 'string') {
    return res.status(400).json({ error: 'Invalid input: value must be a string.' });
  }

  return res.json({ received: value });
});

app.listen(PORT, () => {
  console.log(`UTCP example server running at :${PORT}`);
});
```

### 3. Full LLM Integration Example

For a complete, end-to-end demonstration of how to integrate UTCP with a Large Language Model (LLM) like OpenAI, see the example in `examples/src/full_llm_example/openai_utcp_example.ts`.

This advanced example showcases:
*   **Dynamic Tool Discovery**: No hardcoded tool names. The client loads all available tools from the `providers.json` config.
*   **Relevant Tool Search**: For each user prompt, it uses `utcpClient.search_tools()` to find the most relevant tools for the task.
*   **LLM-Driven Tool Calls**: It instructs the OpenAI model to respond with a custom JSON format to call a tool.
*   **Robust Execution**: It parses the LLM's response, executes the tool call via `utcpClient.call_tool()`, and sends the result back to the model for a final, human-readable answer.
*   **Conversation History**: It maintains a full conversation history for contextual, multi-turn interactions.

**To run the example:**
1.  Navigate to the `examples/` directory.
2.  Install dependencies: `npm install`
3.  Navigate to `src/full_llm_example/`
4.  Rename `example.env` to `.env` and add your OpenAI API key.
5.  Run the example from the `examples` directory: `npx ts-node src/full_llm_example/openai_utcp_example.ts`

## Protocol Specification

UTCP is defined by a set of core data models that describe tools, how to connect to them (providers), and how to secure them (authentication). These models are defined as TypeScript interfaces and Zod schemas for runtime validation.

### Tool Discovery

For a client to use a tool, it must be provided with a `UtcpManual` object. This manual contains a list of all the tools available from a provider. Depending on the provider type, this manual might be retrieved from a discovery endpoint (like an HTTP URL) or loaded from a local source (like a file for a CLI tool).

#### `UtcpManual` Model

```typescript
interface UtcpManual {
  version: string;
  tools: Tool[];
}
```

*   `version`: The version of the UTCP protocol being used.
*   `tools`: A list of `Tool` objects.

### Tool Definition

Each tool is defined by the `Tool` model.

#### `Tool` Model

```typescript
interface Tool {
  name: string;
  description: string;
  inputs: Record<string, any>; // Simplified, uses JSON schema
  outputs: Record<string, any>; // Simplified, uses JSON schema
  tags: string[];
  tool_provider: ToolProvider;
}
```

*   `name`: The name of the tool.
*   `description`: A human-readable description of what the tool does.
*   `inputs`: A JSON schema defining the input parameters for the tool.
*   `outputs`: A JSON schema defining the output of the tool.
*   `tags`: A list of tags for categorizing the tool making searching for relevant tools easier.
*   `tool_provider`: The `ToolProvider` object that describes how to connect to and use the tool.

### Authentication

UTCP supports several authentication methods to secure tool access. The `auth` object within a provider's configuration specifies the authentication method to use.

#### API Key (`ApiKeyAuth`)

Authentication using a static API key, typically sent in a request header.

```json
{
  "auth_type": "api_key",
  "api_key": "YOUR_SECRET_API_KEY",
  "var_name": "X-API-Key"
}
```

#### Basic Auth (`BasicAuth`)

Authentication using a username and password.

```json
{
  "auth_type": "basic",
  "username": "your_username",
  "password": "your_password"
}
```

#### OAuth2 (`OAuth2Auth`)

Authentication using the OAuth2 client credentials flow. The UTCP client will automatically fetch a bearer token from the `token_url` and use it for subsequent requests.

```json
{
  "auth_type": "oauth2",
  "token_url": "https://auth.example.com/token",
  "client_id": "your_client_id",
  "client_secret": "your_client_secret",
  "scope": "read write"
}
```

### Providers

Providers are at the heart of UTCP's flexibility. They define the communication protocol for a given tool. UTCP supports a wide range of provider types:

*   `http`: RESTful HTTP/HTTPS API
*   `sse`: Server-Sent Events
*   `http_stream`: HTTP Chunked Transfer Encoding
*   `cli`: Command Line Interface
*   `websocket`: WebSocket bidirectional connection (work in progress)
*   `grpc`: gRPC (Google Remote Procedure Call) (work in progress)
*   `graphql`: GraphQL query language (work in progress)
*   `tcp`: Raw TCP socket (work in progress)
*   `udp`: User Datagram Protocol (work in progress)
*   `webrtc`: Web Real-Time Communication (work in progress)
*   `mcp`: Model Context Protocol (for interoperability)
*   `text`: Local text file

Each provider type has its own specific configuration options. For example, an `HttpProvider` will have a `url` and an `http_method`.

## Provider Configuration Examples

Below are examples of how to configure each of the supported provider types in a JSON configuration file. Where possible, the tool discovery endpoint should be `/utcp`. Each tool provider should offer users their json provider configuration for the tool discovery endpoint.

### HTTP Provider

For connecting to standard RESTful APIs.

```json
{
  "name": "my_rest_api",
  "provider_type": "http",
  "url": "https://api.example.com/utcp",
  "http_method": "POST",
  "content_type": "application/json",
  "auth": {
    "auth_type": "oauth2",
    "token_url": "https://api.example.com/oauth/token",
    "client_id": "your_client_id",
    "client_secret": "your_client_secret"
  }
}
```

#### Automatic OpenAPI Conversion

UTCP simplifies integration with existing web services by automatically converting OpenAPI v3 specifications into UTCP tools. Instead of pointing to a `UtcpManual`, the `url` for an `http` provider can point directly to an OpenAPI JSON specification. The `OpenApiConverter` handles this conversion automatically, making it seamless to integrate thousands of existing APIs.

```json
{
  "name": "open_library_api",
  "provider_type": "http",
  "url": "https://openlibrary.org/dev/docs/api/openapi.json"
}
```

When the client registers this provider, it will fetch the OpenAPI spec from the URL, convert all defined endpoints into UTCP `Tool` objects, and make them available for searching and calling.

### Server-Sent Events (SSE) Provider

For tools that stream data using SSE. The `url` should point to the discovery endpoint.

```json
{
  "name": "live_updates_service",
  "provider_type": "sse",
  "url": "https://api.example.com/utcp",
  "event_type": "message"
}
```

### CLI Provider

For wrapping local command-line tools.

```json
{
  "name": "my_cli_tool",
  "provider_type": "cli",
  "command_name": "my-command -utcp"
}
```
