# @utcp/http

HTTP-Based Communication Protocols for UTCP

## Overview

The `@utcp/http` package provides comprehensive HTTP-based protocol support for the Universal Tool Calling Protocol (UTCP). It includes **three distinct protocols**:

1. **HTTP** - Standard RESTful HTTP/HTTPS requests
2. **Streamable HTTP** - HTTP with chunked transfer encoding for streaming large responses
3. **SSE** - Server-Sent Events for real-time event streaming

All protocols support multiple authentication methods, URL path parameters, custom headers, and automatic OpenAPI specification conversion.

## Features

### 1. HTTP CallTemplate

Standard HTTP requests for RESTful APIs:

```typescript
interface HttpCallTemplate {
  name: string;
  call_template_type: 'http';
  http_method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  url: string;
  headers?: Record<string, string>;
  body_field?: string;
  content_type?: string;
  timeout?: number;
  auth?: ApiKeyAuth | BasicAuth | OAuth2Auth;
}
```

### 2. Streamable HTTP CallTemplate

HTTP streaming with chunked transfer encoding for large responses:

```typescript
interface StreamableHttpCallTemplate {
  name: string;
  call_template_type: 'streamable_http';
  url: string;
  http_method: 'GET' | 'POST';
  content_type?: string;
  chunk_size?: number;        // Default: 4096 bytes
  timeout?: number;           // Default: 60000ms
  headers?: Record<string, string>;
  body_field?: string;
  header_fields?: string[];
  auth?: ApiKeyAuth | BasicAuth | OAuth2Auth;
}
```

### 3. SSE CallTemplate

Server-Sent Events for real-time streaming:

```typescript
interface SseCallTemplate {
  name: string;
  call_template_type: 'sse';
  url: string;
  event_type?: string;        // Filter specific event types
  reconnect?: boolean;        // Auto-reconnect on disconnect
  retry_timeout?: number;     // Reconnection timeout (ms)
  headers?: Record<string, string>;
  body_field?: string;
  header_fields?: string[];
  auth?: ApiKeyAuth | BasicAuth | OAuth2Auth;
}
```

### HTTP Communication Protocol

*   **Tool Discovery**: Automatically registers tools from:
    *   Remote UTCP Manuals
    *   OpenAPI 2.0 (Swagger) specifications
    *   OpenAPI 3.x specifications
    *   Both JSON and YAML formats

*   **Tool Execution**:
    *   All HTTP methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
    *   URL path parameter substitution: `${param_name}` or `{param_name}`
    *   Query parameter handling
    *   Request body mapping via `body_field`
    *   Custom headers with variable substitution

*   **Authentication Support**:
    *   **API Key**: Header, query parameter, or cookie-based
    *   **Basic Auth**: Username/password authentication
    *   **OAuth2**: Client credentials flow with automatic token caching and refresh

*   **Security**:
    *   Enforces HTTPS or localhost connections
    *   Prevents Man-in-the-Middle (MITM) attacks
    *   OAuth2 token caching to minimize token requests

### OpenAPI Converter

Automatically converts OpenAPI specifications to UTCP tools:
*   Parses OpenAPI 2.0 and 3.x specifications
*   Generates tool definitions with proper schemas
*   Extracts authentication requirements
*   Creates placeholder variables for API keys

## Protocol Comparison

### When to Use Each Protocol

| Protocol | Use Case | Response Type | Best For |
|----------|----------|---------------|----------|
| **HTTP** | Standard RESTful APIs | Complete response | Most APIs, CRUD operations, single requests |
| **Streamable HTTP** | Large data downloads | Chunked streaming | Large files, datasets, progressive data |
| **SSE** | Real-time updates | Event stream | Live updates, notifications, real-time feeds |

### Key Differences

**HTTP**
- ✅ Simple request-response model
- ✅ Complete data in single response
- ✅ All HTTP methods supported
- ❌ Not suitable for large responses
- ❌ No real-time updates

**Streamable HTTP**
- ✅ Efficient for large responses
- ✅ Progressive data processing
- ✅ Reduced memory usage
- ⚠️ Only GET/POST methods
- ❌ No bidirectional communication

**SSE**
- ✅ Real-time event streaming
- ✅ Automatic reconnection
- ✅ Event type filtering
- ✅ Server push updates
- ❌ Unidirectional (server → client only)

## Installation

```bash
npm install @utcp/http @utcp/sdk

# Or with bun
bun add @utcp/http @utcp/sdk
```

**Dependencies:**
- `@utcp/sdk` - Core UTCP SDK (peer dependency)
- `axios` - HTTP client
- `js-yaml` - YAML parsing for OpenAPI specs

## Quick Start

### Automatic Registration

All three HTTP-based protocols (`http`, `streamable_http`, `sse`) are **automatically registered** when you import the UtcpClient. No manual setup required!

### Basic HTTP Usage

```typescript
import { UtcpClient } from '@utcp/sdk';
import { HttpCallTemplateSerializer } from '@utcp/http';

async function main() {
  const serializer = new HttpCallTemplateSerializer();
  const weatherTemplate = serializer.validateDict({
    name: 'weather_api',
    call_template_type: 'http',
    http_method: 'GET',
    url: 'https://api.weatherapi.com/v1/current.json',
    headers: {
      'X-API-Key': '${API_KEY}'
    }
  });

  const client = await UtcpClient.create(process.cwd(), {
    variables: {
      // Namespaced variables for security
      'weather__api_API_KEY': process.env.WEATHER_API_KEY || ''
    },
    manual_call_templates: [weatherTemplate]
  });

  // Call the API
  const weather = await client.callTool('weather_api.get_current', {
    q: 'London'
  });
  
  console.log('Weather:', weather);
  await client.close();
}
```

### With OpenAPI Specification

Automatically discover tools from an OpenAPI spec:

```typescript
import { UtcpClient } from '@utcp/sdk';
import { HttpCallTemplateSerializer } from '@utcp/http';

const serializer = new HttpCallTemplateSerializer();
const petstoreTemplate = serializer.validateDict({
  name: 'petstore_api',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://petstore.swagger.io/v2/swagger.json',
  // Tools will be auto-discovered from the OpenAPI spec
});

const client = await UtcpClient.create(process.cwd(), {
  manual_call_templates: [petstoreTemplate]
});

// Search for discovered tools
const tools = await client.searchTools('pet');
console.log('Available tools:', tools.map(t => t.name));

// Call a discovered tool
const pets = await client.callTool('petstore_api.findPetsByStatus', {
  status: 'available'
});
```

### Streamable HTTP Usage

Stream large responses using chunked transfer encoding:

```typescript
import { UtcpClient } from '@utcp/sdk';
import { StreamableHttpCallTemplateSerializer } from '@utcp/http';

const serializer = new StreamableHttpCallTemplateSerializer();
const streamTemplate = serializer.validateDict({
  name: 'large_data_api',
  call_template_type: 'streamable_http',
  http_method: 'GET',
  url: 'https://api.example.com/large-dataset',
  chunk_size: 8192,  // 8KB chunks
  timeout: 120000,   // 2 minutes
  headers: {
    'Accept': 'application/octet-stream'
  }
});

const client = await UtcpClient.create(process.cwd(), {
  manual_call_templates: [streamTemplate]
});

// Stream the response
const stream = await client.callToolStreaming('large_data_api.get_dataset', {
  filter: 'recent'
});

for await (const chunk of stream) {
  console.log('Received chunk:', chunk.length, 'bytes');
  // Process chunk...
}
```

### SSE (Server-Sent Events) Usage

Real-time event streaming from servers:

```typescript
import { UtcpClient } from '@utcp/sdk';
import { SseCallTemplateSerializer } from '@utcp/http';

const serializer = new SseCallTemplateSerializer();
const sseTemplate = serializer.validateDict({
  name: 'events_api',
  call_template_type: 'sse',
  url: 'https://api.example.com/events',
  event_type: 'notification',  // Filter to specific event type
  reconnect: true,              // Auto-reconnect on disconnect
  retry_timeout: 5000,          // Retry after 5 seconds
  headers: {
    'Authorization': 'Bearer ${API_KEY}'
  }
});

const client = await UtcpClient.create(process.cwd(), {
  variables: {
    'events__api_API_KEY': process.env.SSE_API_KEY || ''
  },
  manual_call_templates: [sseTemplate]
});

// Stream real-time events
const eventStream = await client.callToolStreaming('events_api.stream_events', {
  channel: 'updates'
});

for await (const event of eventStream) {
  console.log('Event received:', event);
  // Handle event...
}
```

### Authentication Examples

#### API Key Authentication

```typescript
import { HttpCallTemplateSerializer } from '@utcp/http';

const serializer = new HttpCallTemplateSerializer();
const callTemplate = serializer.validateDict({
  name: 'api_with_key',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://api.example.com/data',
  auth: {
    auth_type: 'api_key',
    var_name: 'X-API-Key',
    api_key_value: '${API_KEY}',
    in: 'header' // or 'query' or 'cookie'
  }
});
```

#### Basic Authentication

```typescript
const serializer = new HttpCallTemplateSerializer();
const callTemplate = serializer.validateDict({
  name: 'api_with_basic',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://api.example.com/data',
  auth: {
    auth_type: 'basic',
    username: '${USERNAME}',
    password: '${PASSWORD}'
  }
});
```

#### OAuth2 Client Credentials

```typescript
const serializer = new HttpCallTemplateSerializer();
const callTemplate = serializer.validateDict({
  name: 'api_with_oauth',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://api.example.com/data',
  auth: {
    auth_type: 'oauth2',
    token_url: 'https://auth.example.com/oauth/token',
    client_id: '${CLIENT_ID}',
    client_secret: '${CLIENT_SECRET}',
    scope: 'read write'
  }
});
```

### Path Parameters

Use `${param}` or `{param}` syntax for path parameters:

```typescript
const serializer = new HttpCallTemplateSerializer();
const callTemplate = serializer.validateDict({
  name: 'github_api',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://api.github.com/users/${username}',
});

// Call with arguments
await client.callTool('github_api.get_user', {
  username: 'octocat'
});
// Resolves to: https://api.github.com/users/octocat
```

### Request Body

For POST/PUT/PATCH requests, use `body_field`:

```typescript
const serializer = new HttpCallTemplateSerializer();
const callTemplate = serializer.validateDict({
  name: 'create_resource',
  call_template_type: 'http',
  http_method: 'POST',
  url: 'https://api.example.com/resources',
  body_field: 'data',
  content_type: 'application/json',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Call with body
await client.callTool('create_resource.post', {
  data: {
    name: 'My Resource',
    value: 42
  }
});
```

## Use Case Examples

### HTTP: GitHub API Integration

```typescript
const serializer = new HttpCallTemplateSerializer();
const githubTemplate = serializer.validateDict({
  name: 'github_api',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://api.github.com/repos/${owner}/${repo}/issues',
  headers: { 'Authorization': 'Bearer ${TOKEN}' }
});

const client = await UtcpClient.create(process.cwd(), {
  variables: { 'github__api_TOKEN': process.env.GITHUB_TOKEN || '' },
  manual_call_templates: [githubTemplate]
});

const issues = await client.callTool('github_api.get_issues', {
  owner: 'utcp', repo: 'typescript-utcp'
});
```

### Streamable HTTP: Large File Download

```typescript
const serializer = new StreamableHttpCallTemplateSerializer();
const cdnTemplate = serializer.validateDict({
  name: 'cdn',
  call_template_type: 'streamable_http',
  http_method: 'GET',
  url: 'https://cdn.example.com/large-file.zip',
  chunk_size: 16384
});

const client = await UtcpClient.create(process.cwd(), {
  manual_call_templates: [cdnTemplate]
});

const stream = await client.callToolStreaming('cdn.download', {});
for await (const chunk of stream) {
  // Write chunk to file or process incrementally
  fs.appendFileSync('output.zip', chunk);
}
```

### SSE: Stock Price Updates

```typescript
const serializer = new SseCallTemplateSerializer();
const stockTemplate = serializer.validateDict({
  name: 'stock_api',
  call_template_type: 'sse',
  url: 'https://api.stocks.com/stream',
  event_type: 'price_update',
  reconnect: true
});

const client = await UtcpClient.create(process.cwd(), {
  manual_call_templates: [stockTemplate]
});

const priceStream = await client.callToolStreaming('stock_api.watch', {
  symbol: 'AAPL'
});

for await (const update of priceStream) {
  console.log('Price update:', update.price, 'at', update.timestamp);
}
```

## Advanced Features

### Custom Headers with Variables

```typescript
const serializer = new HttpCallTemplateSerializer();
const callTemplate = serializer.validateDict({
  name: 'custom_api',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://api.example.com/data',
  headers: {
    'Authorization': 'Bearer ${TOKEN}',
    'X-Request-ID': '${REQUEST_ID}',
    'User-Agent': 'UTCP-Client/1.0'
  }
});
```

### Timeout Configuration

```typescript
const serializer = new HttpCallTemplateSerializer();
const callTemplate = serializer.validateDict({
  name: 'slow_api',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://api.example.com/slow-endpoint',
  timeout: 60000 // 60 seconds
});
```

### Variable Namespacing

All variables are automatically namespaced by manual name for security:

```typescript
const client = await UtcpClient.create(process.cwd(), {
  variables: {
    // For manual "github_api", variables must be prefixed
    'github__api_TOKEN': 'github-token-123',
    'gitlab__api_TOKEN': 'gitlab-token-456'
  },
  manual_call_templates: [
    {
      name: 'github_api',
      // ...
      headers: {
        // Resolves to "github__api_TOKEN"
        'Authorization': 'Bearer ${TOKEN}'
      }
    }
  ]
});
```

## OpenAPI Conversion

The `OpenApiConverter` automatically:

1. **Parses OpenAPI specs** (2.0 and 3.x)
2. **Extracts endpoints** as individual tools
3. **Generates schemas** for inputs and outputs
4. **Detects authentication** requirements
5. **Creates placeholder variables** for API keys

```typescript
import { OpenApiConverter } from '@utcp/http';

const converter = new OpenApiConverter('https://api.example.com/openapi.json');
const manual = await converter.convert();

console.log('Discovered tools:', manual.tools.length);
```

## Security Features

### HTTPS Enforcement

The HTTP protocol enforces HTTPS or localhost connections by default to prevent MITM attacks:

```typescript
// ✅ Allowed
'https://api.example.com'
'http://localhost:8080'
'http://127.0.0.1:3000'

// ❌ Rejected
'http://api.example.com'  // Non-localhost HTTP
```

### OAuth2 Token Caching

OAuth2 tokens are automatically cached by `client_id` to minimize token requests:

- Tokens are cached until expiration
- Automatic refresh when expired
- Tries both body and auth header methods

## Error Handling

```typescript
try {
  const result = await client.callTool('api_manual.endpoint', args);
} catch (error) {
  if (error.message.includes('401')) {
    console.error('Authentication failed');
  } else if (error.message.includes('404')) {
    console.error('Endpoint not found');
  } else {
    console.error('Request failed:', error);
  }
}
```

## TypeScript Support

Full TypeScript support with exported types for all three protocols:

```typescript
import {
  // HTTP Protocol
  HttpCallTemplate,
  HttpCommunicationProtocol,
  
  // Streamable HTTP Protocol
  StreamableHttpCallTemplate,
  StreamableHttpCommunicationProtocol,
  
  // SSE Protocol
  SseCallTemplate,
  SseCommunicationProtocol,
  
  // OpenAPI Converter
  OpenApiConverter,
  
  // Authentication Types
  ApiKeyAuth,
  BasicAuth,
  OAuth2Auth
} from '@utcp/http';
```

## Testing

```bash
# Run HTTP protocol tests
bun test packages/http/tests/
```

## Related Packages

- `@utcp/sdk` - Core UTCP SDK
- `@utcp/mcp` - MCP protocol support
- `@utcp/text` - File-based tools
- `@utcp/cli` - Command-line tools

## Contributing

See the root repository for contribution guidelines.

## License

Mozilla Public License Version 2.0