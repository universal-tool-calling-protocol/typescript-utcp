# Universal Tool Calling Protocol (UTCP) - TypeScript

## Introduction

The Universal Tool Calling Protocol (UTCP) is a modern, flexible, and scalable standard for defining and interacting with tools across a wide variety of communication protocols. It is designed to be easy to use, interoperable, and extensible, making it a powerful choice for building and consuming tool-based services.

In contrast to other protocols like MCP, UTCP places a strong emphasis on:

*   **Scalability**: UTCP is designed to handle a large number of tools and providers without compromising performance.
*   **Interoperability**: With support for a wide range of provider types (including HTTP, WebSockets, gRPC, and even CLI tools), UTCP can integrate with almost any existing service or infrastructure.
*   **Ease of Use**: The protocol is built on simple, well-defined Zod schemas, making it easy for developers to implement and use.

## Installation

```bash
npm install utcp
```

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
    "name": "cool_public_apis",
    "provider_type": "http",
    "url": "http://utcp.io/public-apis-manual",
    "http_method": "GET"
  }
]
```

**`client.ts`**

This script initializes the client and calls a tool from the provider defined above.

```typescript
import { UtcpClient } from 'utcp';

async function main() {
  // Create a client instance. It automatically loads providers
  // from the specified file path.
  const client = await UtcpClient.create({
    providers_file_path: "./providers.json"
  });

  // Call a tool. The name is namespaced: `provider_name.tool_name`
  const result = await client.callTool(
    "cool_public_apis.example_tool", 
    {}
  );

  console.log(result);
}

main().catch(console.error);
```

### 2. Providing a UTCP Manual

Any type of server or service can be exposed as a UTCP tool. The only requirement is that a `UTCPManual` is provided to the client. This manual can be served by the tool itself or, more powerfully, by a third-party registry. This allows for wrapping existing APIs and services that are not natively UTCP-aware.

Here is a minimal example using Express.js to serve a `UTCPManual` for a tool:

**`server.ts`**
```typescript
import express from 'express';
import { UtcpManual } from 'utcp';

const app = express();

// The discovery endpoint returns the tool manual
app.get('/utcp', (req, res) => {
  const manual: UtcpManual = {
    name: "Weather API",
    version: "1.0.0",
    tools: [
      {
        name: "get_weather",
        description: "Get current weather for a location",
        inputs: {
          type: "object",
          properties: {
            location: { type: "string" }
          }
        },
        outputs: {
          type: "object",
          properties: {
            temperature: { type: "number" }
          }
        },
        tags: ["weather", "api"],
        provider: {
          name: "weather_provider",
          provider_type: "http",
          url: "https://example.com/api/weather",
          http_method: "GET"
        }
      }
    ]
  };
  
  res.json(manual);
});

// The actual tool endpoint
app.get('/api/weather', (req, res) => {
  const location = req.query.location as string;
  res.json({ temperature: 22.5, conditions: "Sunny", location });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## Protocol Specification

UTCP is defined by a set of core data models that describe tools, how to connect to them (providers), and how to secure them (authentication).

### Tool Discovery

For a client to use a tool, it must be provided with a `UtcpManual` object. This manual contains a list of all the tools available from a provider. Depending on the provider type, this manual might be retrieved from a discovery endpoint (like an HTTP URL) or loaded from a local source (like a file for a CLI tool).

#### `UtcpManual` Model

```typescript
interface UtcpManual {
  name: string;
  description?: string;
  version: string;
  tools: Tool[];
}
```

*   `name`: The name of the manual/provider.
*   `description`: Optional description of the manual.
*   `version`: The version of the UTCP protocol being used.
*   `tools`: A list of `Tool` objects.

### Tool Definition

Each tool is defined by the `Tool` model.

#### `Tool` Model

```typescript
interface Tool {
  name: string;
  description: string;
  inputs: ToolInputOutputSchema;
  outputs: ToolInputOutputSchema;
  tags: string[];
  average_response_size?: number;
  provider: ProviderUnion;
}
```

*   `name`: The name of the tool.
*   `description`: A description of what the tool does.
*   `inputs`: The input schema for the tool (JSON Schema format).
*   `outputs`: The output schema for the tool (JSON Schema format).
*   `tags`: A list of tags associated with the tool.
*   `average_response_size`: Optional average size of tool responses.
*   `provider`: The provider configuration for the tool.

### Provider Types

UTCP supports multiple provider types for maximum flexibility:

#### HTTP Provider
```typescript
interface HttpProvider {
  provider_type: "http";
  name: string;
  url: string;
  http_method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  content_type?: string;
  auth?: AuthUnion;
  headers?: Record<string, string>;
  body_field?: string;
  header_fields?: string[];
}
```

#### WebSocket Provider
```typescript
interface WebSocketProvider {
  provider_type: "websocket";
  name: string;
  url: string;
  subprotocols?: string[];
  auth?: AuthUnion;
  headers?: Record<string, string>;
  ping_interval?: number;
  pong_timeout?: number;
}
```

#### CLI Provider
```typescript
interface CliProvider {
  provider_type: "cli";
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
}
```

And many more including gRPC, GraphQL, TCP, UDP, WebRTC, MCP, and Text providers.

### Authentication

UTCP supports multiple authentication methods:

#### API Key Authentication
```typescript
interface ApiKeyAuth {
  auth_type: "api_key";
  api_key: string;
  header_name?: string;
  header_value_prefix?: string;
}
```

#### Basic Authentication
```typescript
interface BasicAuth {
  auth_type: "basic";
  username: string;
  password: string;
}
```

#### OAuth2 Authentication
```typescript
interface OAuth2Auth {
  auth_type: "oauth2";
  client_id: string;
  client_secret: string;
  token_url: string;
  scope?: string;
  grant_type?: string;
}
```

## API Reference

### UtcpClient

The main client class for interacting with UTCP tools.

#### Methods

- `static create(config: UtcpClientConfig): Promise<UtcpClient>`
- `registerToolProvider(provider: ProviderUnion): Promise<Tool[]>`
- `deregisterToolProvider(providerName: string): void`
- `callTool(toolName: string, args: Record<string, any>): Promise<any>`
- `getAvailableTools(): Tool[]`
- `searchTools(query: string): Tool[]`
- `getToolsByTag(tag: string): Tool[]`
- `cleanup(): Promise<void>`

### Configuration

```typescript
interface UtcpClientConfig {
  providers_file_path?: string;
  providers?: any[];
  tool_repository_type?: 'in_memory';
  search_strategy?: 'tag';
  max_concurrent_calls?: number;
  default_timeout?: number;
  retry_attempts?: number;
  retry_delay?: number;
}
```

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

## License

This project is licensed under the MPL-2.0 License - see the [LICENSE](LICENSE) file for details.

## Links

*   [Homepage](https://utcp.io)
*   [GitHub Repository](https://github.com/universal-tool-calling-protocol/typescript-utcp)
*   [Issues](https://github.com/universal-tool-calling-protocol/typescript-utcp/issues)
