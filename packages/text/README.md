# @utcp/text: Text File Communication Protocol Plugin for UTCP

The `@utcp/text` package provides a straightforward communication protocol for the Universal Tool Calling Protocol (UTCP) client to interact with local text files. It's primarily used for loading static UTCP Manuals or OpenAPI specifications directly from local JSON or YAML files, without needing a network request.

## Features

*   **Text `CallTemplate`**: Defines the configuration for file-based tool definitions (`TextCallTemplate`), specifying the `file_path` to the local manual or spec. Authentication is explicitly `null` as file access typically relies on local permissions.
*   **`TextCommunicationProtocol`**: Implements the `CommunicationProtocol` interface for file-based interactions:
    *   **Tool Discovery**: Reads and parses local JSON or YAML files. It can directly interpret UTCP Manuals or automatically convert OpenAPI (v2/v3) specifications into UTCP `Tool` definitions (by utilizing the `OpenApiConverter` from `@utcp/http`).
    *   **Tool Execution**: When a tool associated with a `TextCallTemplate` is "called", the protocol simply returns the raw content of the configured `file_path` as a string. This is useful for retrieving static data, configuration snippets, or even full documentation embedded as a tool.
    *   **Stateless**: This protocol does not maintain any persistent connections or external resources, making it very lightweight.
    *   **Path Resolution**: Resolves relative file paths using the `UtcpClient`'s configured root directory (`_rootPath`), ensuring flexibility in project structure.

## Installation

```bash
bun add @utcp/text @utcp/core @utcp/http js-yaml
```

Note: `@utcp/core` is a peer dependency. `@utcp/http` is a direct dependency because `TextCommunicationProtocol` uses its `OpenApiConverter` for spec conversion, and `js-yaml` is needed for YAML parsing.

## Usage

To use the Text plugin, you must register its capabilities with the core `UtcpClient` at application startup. This is typically done by calling the `registerTextPlugin()` function exported from `@utcp/text`. Additionally, `registerHttpPlugin()` should be called if you intend to load OpenAPI specs via text files.

```typescript
// From your application's entry point

import { UtcpClient } from '@utcp/core/client/utcp_client';
import { UtcpClientConfigSchema } from '@utcp/core/client/utcp_client_config';
import { TextCallTemplateSchema } from '@utcp/text/text_call_template';
import { registerTextPlugin } from '@utcp/text'; // Import Text plugin registration
import { registerHttpPlugin } from '@utcp/http';   // Required for OpenAPI conversion support
import * as path from 'path';
import * as fs from 'fs/promises'; // For creating dummy files

// --- IMPORTANT: Register necessary plugins at application startup ---
registerTextPlugin();
registerHttpPlugin(); // Ensure HTTP plugin is registered if using OpenAPI via Text
// -------------------------------------------------------------------

async function main() {
  // Create a dummy UTCP manual file for demonstration
  const manualContent = {
    "utcp_version": "1.0.0",
    "manual_version": "1.0.0",
    "tools": [
      {
        "name": "read_static_data",
        "description": "Reads static data from a local file.",
        "inputs": {},
        "outputs": { "type": "string", "description": "The content of the file." },
        "tags": ["file", "static"],
        "tool_call_template": {
          "name": "static_file_reader",
          "call_template_type": "text",
          "file_path": "./config/static_data.txt" // The file path for the tool's content
        }
      },
      {
        "name": "describe_project",
        "description": "Provides a description of the project from a local markdown file.",
        "inputs": {},
        "outputs": { "type": "string" },
        "tags": ["documentation"],
        "tool_call_template": {
          "name": "project_readme_reader",
          "call_template_type": "text",
          "file_path": "./README.md" // Example: reads the project's README
        }
      }
    ]
  };
  const configDirPath = path.resolve(process.cwd(), './config');
  await fs.mkdir(configDirPath, { recursive: true });

  const dummyManualPath = path.resolve(configDirPath, './my_local_manual.json');
  await fs.writeFile(dummyManualPath, JSON.stringify(manualContent, null, 2));

  const staticDataPath = path.resolve(configDirPath, './static_data.txt');
  await fs.writeFile(staticDataPath, 'Hello from UTCP Text Plugin static data!');

  // Define a CallTemplate to load the local UTCP manual from the 'config' directory
  const textCallTemplate = TextCallTemplateSchema.parse({
    name: 'local_manual_loader',
    call_template_type: 'text',
    file_path: './config/my_local_manual.json', // Path relative to client's root_path
  });

  const client = await UtcpClient.create(
    UtcpClientConfigSchema.parse({
      manual_call_templates: [textCallTemplate], // Register the text manual at client startup
      // rootPath: process.cwd(), // UtcpClient.create will infer this by default
    })
  );

  console.log('Text Plugin active. Searching for tools...');

  // Example: Call 'read_static_data' tool. This will return the content of 'static_data.txt'.
  try {
    const staticDataReaderTool = await client.searchTools('read static data');
    if (staticDataReaderTool.length > 0) {
      const result = await client.callTool(staticDataReaderTool.name, {});
      console.log('Result from "read_static_data" tool:', result);
    }
  } catch (error) {
    console.error('Error calling "read_static_data" tool:', error);
  }

  // Example: Call 'describe_project' tool. This will return the content of the project's README.md.
  try {
    const projectDescTool = await client.searchTools('project description');
    if (projectDescTool.length > 0) {
      const result = await client.callTool(projectDescTool.name, {});
      console.log('Result from "describe_project" tool (first 100 chars):', String(result).substring(0, 100) + '...');
    }
  } catch (error) {
    console.error('Error calling "describe_project" tool:', error);
  } finally {
    // Clean up dummy files
    await fs.unlink(dummyManualPath);
    await fs.unlink(staticDataPath);
    await fs.rmdir(configDirPath); // Remove the config directory
  }

  await client.close(); // No-op for text protocol, but good practice
}

main().catch(console.error);
```

## Development

Refer to the root `README.md` for monorepo development and testing instructions.
