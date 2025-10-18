# @utcp/core: Universal Tool Calling Protocol (UTCP) Core SDK

The `@utcp/core` package provides the fundamental components and interfaces for the Universal Tool Calling Protocol (UTCP) in TypeScript. It is designed to be lean and extensible, serving as the central hub for integrating various communication protocols via a plugin-based architecture.

## Features

*   **Core Data Models**: Defines the essential UTCP data structures including `Auth`, `CallTemplateBase`, `Tool`, and `UtcpManual` using Zod for robust runtime validation and type safety.
*   **Pluggable Interfaces**: Provides abstract interfaces for key architectural components:
    *   `CommunicationProtocol`: Defines the contract for protocol-specific communication (e.g., HTTP, CLI, MCP).
    *   `ToolRepository`: An interface for storing and retrieving tools with thread-safe access (conceptually, in JavaScript).
    *   `ToolSearchStrategy`: An interface for implementing tool search algorithms.
*   **Default Implementations**: Includes basic, in-memory implementations for core interfaces:
    *   `InMemToolRepository`: A simple, in-memory tool repository.
    *   `TagSearchStrategy`: A basic strategy for searching tools by tags and description keywords.
*   **`UtcpClient`**: The main client for interacting with the UTCP ecosystem, responsible for:
    *   Loading configuration (`UtcpClientConfig`).
    *   Registering and deregistering manuals (collections of tools).
    *   Calling tools through registered communication protocols.
    *   Searching for tools using a configurable strategy.
    *   Handling variable substitution in configurations (`UtcpVariableNotFoundError`).
*   **Plugin Registry**: A central mechanism (`pluginRegistry`) where external protocol plugins can register their `CommunicationProtocol` implementations and `CallTemplate` schemas, enabling dynamic extensibility.

## Installation

```bash
bun add @utcp/core
```

## Usage

The `UtcpClient` is the primary entry point for using the core SDK. It orchestrates interactions with various plugins. You will typically import and register specific plugins (like `@utcp/http`) at the start of your application.

```typescript
import { UtcpClient } from '@utcp/core/client/utcp_client';
import { UtcpClientConfigSchema } from '@utcp/core/client/utcp_client_config';
import { InMemToolRepository } from '@utcp/core/implementations/in_mem_tool_repository';
import { TagSearchStrategy } from '@utcp/core/implementations/tag_search_strategy';
// Example: import and register a plugin (must be done before client.create)
// import { registerHttpPlugin } from '@utcp/http';
// registerHttpPlugin();

async function initializeClient() {
  const config = UtcpClientConfigSchema.parse({
    variables: {
      SOME_API_KEY: 'your-secret-key'
    },
    // manual_call_templates can be provided here or registered dynamically later
    manual_call_templates: [],
    load_variables_from: []
  });

  const client = await UtcpClient.create(
    config,
    new InMemToolRepository(), // Optional: provide custom repository
    new TagSearchStrategy()     // Optional: provide custom search strategy
  );
  return client;
}

// Example usage:
async function main() {
  const client = await initializeClient();

  // client.registerManual(...) // Register additional manuals dynamically
  // const relevantTools = await client.searchTools('search query');
  // const result = await client.callTool('manual_name.tool_name', { arg1: 'value' });

  await client.close(); // Important for cleanup
}

main().catch(console.error);
```

## Development

Refer to the root `README.md` for monorepo development and testing instructions.