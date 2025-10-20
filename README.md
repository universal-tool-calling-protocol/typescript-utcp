# Universal Tool Calling Protocol (UTCP) for TypeScript

[![Follow Org](https://img.shields.io/github/followers/universal-tool-calling-protocol?label=Follow%20Org&logo=github)](https://github.com/universal-tool-calling-protocol)
[![NPM version](https://img.shields.io/npm/v/@utcp/sdk.svg)](https://www.npmjs.com/package/@utcp/sdk)
[![License](https://img.shields.io/github/license/universal-tool-calling-protocol/python-utcp)](https://github.com/universal-tool-calling-protocol/typescript-utcp/blob/main/LICENSE)
[![CDTM S23](https://img.shields.io/badge/CDTM-S23-0b84f3)](https://cdtm.com/)

**The Universal Tool Calling Protocol (UTCP) is a secure, and scalable standard for defining and interacting with tools across a wide variety of communication protocols. This repository contains the official TypeScript implementation, structured as a monorepo with a lean core and pluggable communication protocols.**

UTCP offers a unified framework for integrating disparate tools and services, making them accessible through a consistent and well-defined interface. This TypeScript SDK provides a comprehensive toolkit for developers to leverage the full power of the UTCP standard in their applications.

## Key Features

*   **Automatic Plugin Registration**: The official plugins are automatically discovered and registered when you import the core client—no manual setup required. For other plugins, you will need to register them manually.
*   **Scalability**: Designed to handle a large number of tools and providers without compromising performance.
*   **Extensibility**: A pluggable architecture allows developers to easily add new communication protocols, tool storage mechanisms, and search strategies without modifying the core library.
*   **Interoperability**: With a growing ecosystem of protocol plugins—including HTTP, MCP, Text, and CLI—UTCP can integrate with almost any existing service or infrastructure.
*   **Type Safety**: Built on well-defined TypeScript interfaces and runtime validation powered by Zod, making it robust and developer-friendly.
*   **Secure Variable Management**: Namespace-isolated variables prevent leakage between manuals, with support for environment variables and .env files.

![MCP vs. UTCP](https://github.com/user-attachments/assets/3cadfc19-8eea-4467-b606-66e580b89444)

## Getting Started

### Installation

Install UTCP packages from npm:

```bash
# Install core SDK and desired protocol plugins
npm install @utcp/sdk @utcp/http @utcp/mcp @utcp/text

# Or using bun
bun add @utcp/sdk @utcp/http @utcp/mcp @utcp/text
```

### For Development

To set up the monorepo for development:

```bash
# Clone the repository
git clone https://github.com/universal-tool-calling-protocol/typescript-utcp.git
cd typescript-utcp

# Install dependencies (requires bun)
bun install

# Build all packages
bun run build
```

## Quick Start

### Basic Usage

Plugins are **automatically registered** when you import the UtcpClient—no manual registration needed!

```typescript
import { UtcpClient } from '@utcp/sdk';
import { HttpCallTemplateSerializer } from '@utcp/http';

async function main() {
  // Create client - plugins auto-register
  const serializer = new HttpCallTemplateSerializer();
  const githubTemplate = serializer.validateDict({
    name: 'github_api',
    call_template_type: 'http',
    http_method: 'GET',
    url: 'https://api.github.com/users/${username}',
  });

  const client = await UtcpClient.create(process.cwd(), {
    manual_call_templates: [githubTemplate],
    variables: {
      // Namespace format: manual_name_VARIABLE
      github__api_username: 'octocat'
    }
  });

  // Search for tools
  const tools = await client.searchTools('github user');
  console.log('Found tools:', tools.map(t => t.name));

  // Call a tool
  const result = await client.callTool('github_api.get_user', {});
  console.log('Result:', result);

  await client.close();
}

main().catch(console.error);
```

### Working with Multiple Protocols

```typescript
import { UtcpClient } from '@utcp/sdk';
import { HttpCallTemplateSerializer } from '@utcp/http';
import { McpCallTemplateSerializer } from '@utcp/mcp';
import { TextCallTemplateSerializer } from '@utcp/text';

async function main() {
  // Create serializers for each protocol
  const httpSerializer = new HttpCallTemplateSerializer();
  const mcpSerializer = new McpCallTemplateSerializer();
  const textSerializer = new TextCallTemplateSerializer();

  // Validate and create call templates
  const httpTemplate = httpSerializer.validateDict({
    name: 'api_manual',
    call_template_type: 'http',
    http_method: 'GET',
    url: 'https://api.example.com/data',
    headers: {
      'Authorization': 'Bearer ${API_KEY}'
    }
  });

  const mcpTemplate = mcpSerializer.validateDict({
    name: 'mcp_tools',
    call_template_type: 'mcp',
    config: {
      mcpServers: {
        my_mcp_server: {
          transport: 'stdio',
          command: 'node',
          args: ['./mcp-server.js'],
          cwd: './servers'
        }
      }
    }
  });

  const textTemplate = textSerializer.validateDict({
    name: 'local_tools',
    call_template_type: 'text',
    file_path: './config/tools.json'
  });

  const client = await UtcpClient.create(process.cwd(), {
    variables: {
      // Namespaced variables for security
      api__manual_API_KEY: process.env.API_KEY || 'default-key',
    },
    load_variables_from: [
      {
        variable_loader_type: 'dotenv',
        env_file_path: './.env'
      }
    ],
    manual_call_templates: [
      httpTemplate,  // HTTP API
      mcpTemplate,   // MCP Server
      textTemplate   // Local file-based tools
    ]
  });

  // Tools are namespaced: manual_name.tool_name
  // For MCP: manual_name.server_name.tool_name
  const allTools = await client.getTools();
  console.log('Registered tools:', allTools.map(t => t.name));
  
  // Examples:
  // - 'api_manual.get_data'
  // - 'mcp_tools.my_mcp_server.echo'
  // - 'local_tools.my_function'

  await client.close();
}
```

## API Reference

### UtcpClient.create()

```typescript
static async create(
  root_dir: string,
  config: Partial<UtcpClientConfig>
): Promise<UtcpClient>
```

**Parameters:**
- `root_dir`: Base directory for resolving relative paths (usually `process.cwd()`)
- `config`: Client configuration object

**Configuration Options:**

```typescript
interface UtcpClientConfig {
  // Direct variable definitions (highest priority)
  variables?: Record<string, string>;
  
  // External variable loaders (e.g., .env files)
  load_variables_from?: Array<{
    variable_loader_type: 'dotenv';
    env_file_path: string;
  }>;
  
  // Manual call templates to register at startup
  manual_call_templates?: CallTemplate[];
  
  // Tool repository configuration (defaults to in-memory)
  tool_repository?: ConcurrentToolRepository;
  
  // Search strategy configuration (defaults to tag_and_description_word_match)
  tool_search_strategy?: ToolSearchStrategy;
  
  // Post-processing configurations
  post_processing?: ToolPostProcessor[];
}
```

### Core Methods

#### Search Tools
```typescript
async searchTools(
  query: string,
  limit?: number,
  anyOfTagsRequired?: string[]
): Promise<Tool[]>
```

Searches for tools matching the query. The search considers:
- **Tool names** (highest priority)
- **Tool tags**
- **Tool descriptions**

#### Call Tool
```typescript
async callTool(
  toolName: string,
  args: Record<string, any>
): Promise<any>
```

Executes a tool with the given arguments. Tool names follow these formats:
- HTTP/Text/CLI: `manual_name.tool_name`
- MCP: `manual_name.server_name.tool_name`

#### Get Tools
```typescript
async getTools(): Promise<Tool[]>
async getTool(toolName: string): Promise<Tool | undefined>
```

Retrieve all registered tools or get a specific tool by name.

#### Register/Deregister Manuals
```typescript
async registerManual(callTemplate: CallTemplate): Promise<void>
async deregisterManual(manualName: string): Promise<boolean>
```

Dynamically add or remove tool manuals at runtime.

## Variable Management

### Variable Namespacing (Security Feature)

Variables are **namespace-isolated** by manual name to prevent variable leakage between manuals:

```typescript
// For a manual named "github_api", variables are accessed as:
// ${VARIABLE} -> resolved from "github__api_VARIABLE"

import { HttpCallTemplateSerializer } from '@utcp/http';

const serializer = new HttpCallTemplateSerializer();
const githubTemplate = serializer.validateDict({
  name: 'github_api',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://api.github.com/users',
  headers: {
    // Resolves to 'github__api_TOKEN' only
    'Authorization': 'Bearer ${TOKEN}'
  }
});

const client = await UtcpClient.create(process.cwd(), {
  variables: {
    'github__api_TOKEN': 'github-token-123',
    'slack__api_TOKEN': 'slack-token-456',
  },
  manual_call_templates: [githubTemplate]
});
```

**Namespace transformation**: Manual name underscores become double underscores:
- `github_api` → `github__api_`
- `my-service` → `my_service_` (hyphens to underscores)

### Variable Resolution Order

1. **Client config variables** (highest priority)
2. **Variable loaders** (e.g., .env files, in order)
3. **Environment variables** (lowest priority)

All lookups use the namespaced key: `{namespace}_VARIABLE_NAME`.

### Loading from .env Files

```typescript
const client = await UtcpClient.create(process.cwd(), {
  load_variables_from: [
    {
      variable_loader_type: 'dotenv',
      env_file_path: './.env'
    }
  ]
});
```

## Communication Protocols

### HTTP Protocol

Supports RESTful APIs with automatic OpenAPI specification conversion:

```typescript
import { HttpCallTemplateSerializer } from '@utcp/http';

const serializer = new HttpCallTemplateSerializer();
const weatherTemplate = serializer.validateDict({
  name: 'weather_api',
  call_template_type: 'http',
  http_method: 'GET',
  url: 'https://api.weather.com/v1/forecast',
  headers: {
    'X-API-Key': '${API_KEY}'
  },
  // Optional: Basic, API Key, or OAuth2 authentication
  auth: {
    auth_type: 'api_key',
    var_name: 'X-API-Key',
    api_key_value: '${API_KEY}',
    in: 'header'
  }
});
```

**Features:**
- Path parameter substitution
- Header and body templates
- Multiple authentication methods
- Automatic OpenAPI to UTCP conversion

### MCP Protocol

Connect to Model Context Protocol servers:

```typescript
import { McpCallTemplateSerializer } from '@utcp/mcp';

const serializer = new McpCallTemplateSerializer();
const mcpTemplate = serializer.validateDict({
  name: 'mcp_manual',
  call_template_type: 'mcp',
  config: {
    mcpServers: {
      server_name: {
        transport: 'stdio', // or 'http'
        command: 'bun',
        args: ['run', './mcp-server.ts'],
        cwd: './servers',
        env: { DEBUG: 'true' }
      }
    }
  }
});
```

**Tool Naming:** `manual_name.server_name.tool_name`

**Features:**
- Stdio and HTTP transports
- Persistent session management
- Automatic retry on connection errors
- Multiple servers per manual

### Text Protocol

Load tools from local JSON/YAML files or OpenAPI specs:

```typescript
import { TextCallTemplateSerializer } from '@utcp/text';

const serializer = new TextCallTemplateSerializer();
const textTemplate = serializer.validateDict({
  name: 'local_tools',
  call_template_type: 'text',
  file_path: './config/tools.json'
  // Supports: .json, .yaml, .yml, OpenAPI specs
});
```

### CLI Protocol

Execute command-line tools:

```typescript
import { CliCallTemplateSerializer } from '@utcp/cli';

const serializer = new CliCallTemplateSerializer();
const cliTemplate = serializer.validateDict({
  name: 'system_commands',
  call_template_type: 'cli',
  commands: [
    {
      command: 'git status'
    }
  ],
  working_dir: './my-repo'
});
```

## Monorepo Structure

```
typescript-utcp/
├── packages/
│   ├── core/          # Core SDK with UtcpClient and interfaces
│   ├── http/          # HTTP protocol plugin
│   ├── mcp/           # MCP protocol plugin
│   ├── text/          # Text/file protocol plugin
│   └── cli/           # CLI protocol plugin
├── tests/             # End-to-end integration tests
└── README.md
```

Each package is independently published to npm:
- `@utcp/sdk` - Core SDK library (required)
- `@utcp/http` - HTTP protocol support
- `@utcp/mcp` - MCP protocol support
- `@utcp/text` - File-based tools
- `@utcp/cli` - Command-line tools

## Development & Testing

### Build

```bash
# Build all packages
bun run build

# Clean and rebuild
bun run rebuild
```

### Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/utcp_client.test.ts
```

### Publishing

```bash
# Publish all packages
bun run publish:all

# Or publish individually
bun run publish:core
bun run publish:http
bun run publish:mcp
```

## Advanced Features

### Custom Tool Repositories

Implement custom storage backends:

```typescript
import { ConcurrentToolRepository } from '@utcp/sdk';

class RedisToolRepository implements ConcurrentToolRepository {
  // Implement required methods
  async getTools(): Promise<Tool[]> { /* ... */ }
  async getTool(name: string): Promise<Tool | undefined> { /* ... */ }
  // ... other methods
}
```

### Custom Search Strategies

Implement custom tool search algorithms:

```typescript
import { ToolSearchStrategy } from '@utcp/sdk';

class SemanticSearchStrategy implements ToolSearchStrategy {
  async searchTools(
    repository: ConcurrentToolRepository,
    query: string,
    limit?: number
  ): Promise<Tool[]> {
    // Custom semantic search implementation
  }
}
```

### Post-Processors

Transform tool results:

```typescript
const client = await UtcpClient.create(process.cwd(), {
  post_processing: [
    {
      tool_post_processor_type: 'filter_dict',
      allowed_keys: ['id', 'name', 'email']
    },
    {
      tool_post_processor_type: 'limit_strings',
      max_length: 1000
    }
  ]
});
```

## Best Practices

1. **Always call `client.close()`** to properly clean up resources
2. **Use namespaced variables** for security and isolation
3. **Leverage automatic plugin registration** - no manual setup needed
4. **Use TypeScript types** from protocol packages for call templates
5. **Handle tool call errors** appropriately in production
6. **Test with integration tests** using the test patterns in `/tests`

## License

This project is licensed under the Mozilla Public License Version 2.0. See the `LICENSE` file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Code of Conduct

This project has adopted the Contributor Covenant Code of Conduct. For more information, see the [Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
