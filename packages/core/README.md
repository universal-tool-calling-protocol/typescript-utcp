# @utcp/sdk

Universal Tool Calling Protocol (UTCP) Core SDK for TypeScript

## Overview

The `@utcp/sdk` package provides the fundamental components and interfaces for the Universal Tool Calling Protocol (UTCP) in TypeScript. It is designed to be lean and extensible, serving as the central hub for integrating various communication protocols via a plugin-based architecture.

## Features

### Core Components

*   **UtcpClient**: The main client for interacting with the UTCP ecosystem
    *   Automatic plugin registration for official protocols (HTTP, MCP, Text, CLI)
    *   Manual and tool registration/deregistration
    *   Tool search with name, tag, and description matching
    *   Tool execution across multiple protocols
    *   Secure namespace-isolated variable management

*   **Data Models**: Type-safe data structures with Zod validation
    *   `Tool`: Tool definitions with inputs/outputs schemas
    *   `CallTemplate`: Protocol-specific call templates
    *   `Auth`: Authentication configurations (API Key, Basic, OAuth2)
    *   `UtcpManual`: Tool collections

*   **Pluggable Architecture**:
    *   `CommunicationProtocol`: Interface for protocol implementations
    *   `ConcurrentToolRepository`: Interface for tool storage (default: in-memory)
    *   `ToolSearchStrategy`: Interface for search algorithms (default: tag-based)
    *   `VariableSubstitutor`: Interface for variable resolution

*   **Security Features**:
    *   Namespace-isolated variables prevent leakage between manuals
    *   Multiple variable sources (config, .env files, environment)
    *   Hierarchical variable resolution

## Installation

```bash
npm install @utcp/sdk

# Or with bun
bun add @utcp/sdk
```

## Quick Start

### Basic Usage

Plugins are **automatically registered** when you import the UtcpClient:

```typescript
import { UtcpClient } from '@utcp/sdk';
import { HttpCallTemplateSerializer } from '@utcp/http';

async function main() {
  // Create client - official plugins auto-register
  const serializer = new HttpCallTemplateSerializer();
  const apiTemplate = serializer.validateDict({
    name: 'api_manual',
    call_template_type: 'http',
    http_method: 'GET',
    url: 'https://api.example.com/data',
    headers: {
      'Authorization': 'Bearer ${API_KEY}' // Resolves to api__manual_API_KEY
    }
  });

  const client = await UtcpClient.create(process.cwd(), {
    variables: {
      // Namespaced format: manual_name_VARIABLE
      api__manual_API_KEY: process.env.API_KEY || ''
    },
    manual_call_templates: [apiTemplate]
  });

  // Search for tools
  const tools = await client.searchTools('data');
  
  // Call a tool
  const result = await client.callTool('api_manual.get_data', {});
  
  await client.close();
}
```

### With Environment Variables

```typescript
import { UtcpClient } from '@utcp/sdk';

const client = await UtcpClient.create(process.cwd(), {
  load_variables_from: [
    {
      variable_loader_type: 'dotenv',
      env_file_path: './.env'
    }
  ],
  variables: {
    // Direct config (highest priority)
    'github__api_TOKEN': 'override-token'
  }
});
```

## API Reference

### UtcpClient.create()

```typescript
static async create(
  root_dir: string,
  config?: Partial<UtcpClientConfig>
): Promise<UtcpClient>
```

**Parameters:**
- `root_dir`: Base directory for resolving relative paths (typically `process.cwd()`)
- `config`: Optional configuration object

**Configuration:**

```typescript
interface UtcpClientConfig {
  // Variable definitions (highest priority)
  variables?: Record<string, string>;
  
  // External variable loaders
  load_variables_from?: VariableLoader[];
  
  // Initial manuals to register
  manual_call_templates?: CallTemplate[];
  
  // Tool storage (default: in-memory)
  tool_repository?: ConcurrentToolRepository;
  
  // Search algorithm (default: tag and description matching)
  tool_search_strategy?: ToolSearchStrategy;
  
  // Result post-processors
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

Searches for tools matching the query. Considers:
- Tool names (highest priority)
- Tool tags
- Tool descriptions

#### Call Tool
```typescript
async callTool(
  toolName: string,
  args: Record<string, any>
): Promise<any>
```

Execute a tool. Tool names use format:
- Standard: `manual_name.tool_name`
- MCP: `manual_name.server_name.tool_name`

#### Get Tools
```typescript
async getTools(): Promise<Tool[]>
async getTool(toolName: string): Promise<Tool | undefined>
```

#### Register/Deregister Manuals
```typescript
async registerManual(callTemplate: CallTemplate): Promise<void>
async deregisterManual(manualName: string): Promise<boolean>
async registerManuals(callTemplates: CallTemplate[]): Promise<void>
```

#### Variable Utilities
```typescript
async getRequiredVariablesForTool(toolName: string): Promise<string[]>
```

#### Cleanup
```typescript
async close(): Promise<void>
```

Closes all communication protocols and releases resources.

## Variable Management

### Namespace Isolation

Variables are automatically namespaced by manual name for security:

```typescript
// Manual name: "github_api"
// Variable reference: ${TOKEN}
// Actual lookup: "github__api_TOKEN"

const client = await UtcpClient.create(process.cwd(), {
  variables: {
    'github__api_TOKEN': 'github-secret',
    'slack__api_TOKEN': 'slack-secret',
  },
  manual_call_templates: [
    {
      name: 'github_api',
      // ... 
      headers: {
        // Resolves ONLY to 'github__api_TOKEN'
        'Authorization': 'Bearer ${TOKEN}'
      }
    }
  ]
});
```

**Namespace transformation:**
- `github_api` → `github__api_`
- Underscores become double underscores
- Hyphens converted to underscores

### Variable Resolution Order

1. `config.variables` (highest priority)
2. Variable loaders (e.g., .env files, in order)
3. Environment variables (lowest priority)

All lookups use the namespaced key: `{namespace}_VARIABLE_NAME`

## Plugin System

### Automatic Registration

Official plugins (HTTP, MCP, Text, CLI) are automatically registered when you import `UtcpClient`. The plugin loader in `@utcp/sdk` tries to discover and register available plugins.

### Manual Registration

For custom or third-party plugins:

```typescript
import { CallTemplateSerializer } from '@utcp/sdk';
import { CommunicationProtocol } from '@utcp/sdk';

// Register custom call template
CallTemplateSerializer.registerCallTemplate(
  'custom_type',
  new CustomCallTemplateSerializer()
);

// Register custom protocol
CommunicationProtocol.communicationProtocols['custom_type'] = 
  new CustomCommunicationProtocol();
```

## Advanced Usage

### Custom Tool Repository

```typescript
import { ConcurrentToolRepository, Tool } from '@utcp/sdk';

class CustomRepository implements ConcurrentToolRepository {
  tool_repository_type = 'custom' as const;
  
  async getTools(): Promise<Tool[]> { /* ... */ }
  async getTool(name: string): Promise<Tool | undefined> { /* ... */ }
  async saveManual(callTemplate: CallTemplate, manual: UtcpManual): Promise<void> { /* ... */ }
  async removeManual(manualName: string): Promise<boolean> { /* ... */ }
  // ... implement other required methods
}

const client = await UtcpClient.create(process.cwd(), {
  tool_repository: new CustomRepository()
});
```

### Custom Search Strategy

```typescript
import { ToolSearchStrategy } from '@utcp/sdk';

class CustomSearchStrategy implements ToolSearchStrategy {
  tool_search_strategy_type = 'custom' as const;
  
  async searchTools(
    repository: ConcurrentToolRepository,
    query: string,
    limit?: number,
    anyOfTagsRequired?: string[]
  ): Promise<Tool[]> {
    // Implement custom search logic
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

## Error Handling

```typescript
import { UtcpVariableNotFoundError } from '@utcp/sdk';

try {
  await client.callTool('manual.tool', {});
} catch (error) {
  if (error instanceof UtcpVariableNotFoundError) {
    console.error(`Missing variable: ${error.variableName}`);
  }
  throw error;
}
```

## TypeScript Support

The package is fully typed with TypeScript. All schemas are validated at runtime using Zod:

```typescript
import { ToolSchema, CallTemplateSchema } from '@utcp/sdk';

// Runtime validation
const tool = ToolSchema.parse(toolData);
const callTemplate = CallTemplateSchema.parse(templateData);
```

## Package Structure

```
@utcp/sdk/
├── client/              # UtcpClient and configuration
├── data/                # Core data models (Tool, CallTemplate, Auth, etc.)
├── interfaces/          # Abstract interfaces for plugins
├── implementations/     # Default implementations
│   ├── in_mem_concurrent_tool_repository.ts
│   ├── tag_search_strategy.ts
│   └── default_variable_substitutor.ts
└── plugins/             # Plugin loader and registry
```

## Related Packages

- **`@utcp/sdk`** - Core SDK (this package)
- `@utcp/http` - HTTP protocol support with OpenAPI conversion
- `@utcp/mcp` - Model Context Protocol integration
- `@utcp/text` - File-based tool loading
- `@utcp/cli` - Command-line tool execution

## Contributing

See the root repository for contribution guidelines.

## License

Mozilla Public License Version 2.0