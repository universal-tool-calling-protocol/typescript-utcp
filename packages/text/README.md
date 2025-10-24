# @utcp/text

Text Content Communication Protocol plugin for the Universal Tool Calling Protocol (UTCP).

## Overview

This plugin provides support for loading UTCP manuals and tool definitions from direct text/string content. Unlike `@utcp/file` which reads from files, this plugin is **browser-compatible** and works in any JavaScript environment.

## Installation

```bash
npm install @utcp/text
```

## Usage

The plugin automatically registers itself when imported:

```typescript
import '@utcp/text';
import { UtcpClient } from '@utcp/sdk';

const utcpManualContent = JSON.stringify({
  tools: [
    {
      name: 'my_tool',
      description: 'A sample tool',
      inputs: { type: 'object', properties: {} },
      outputs: { type: 'object', properties: {} }
    }
  ]
});

const client = await UtcpClient.create();
await client.registerCallTemplate({
  call_template_type: 'text',
  name: 'my-manual',
  content: utcpManualContent
});
```

## Features

- **Browser-Compatible**: No file system dependencies
- **Multiple Formats**: Supports both JSON and YAML content
- **OpenAPI Conversion**: Automatically converts OpenAPI specs to UTCP manuals
- **Type-Safe**: Full TypeScript support with Zod validation

## Text Call Template

The text call template accepts the following configuration:

- `call_template_type`: Must be set to `'text'`
- `name`: Unique identifier for this manual
- `content`: String content containing the UTCP manual or OpenAPI spec (required)
- `auth_tools`: Optional authentication to apply to tools from OpenAPI specs

## Example: OpenAPI Spec

```typescript
import '@utcp/text';
import { UtcpClient } from '@utcp/sdk';

const openApiSpec = `
openapi: 3.0.0
info:
  title: My API
  version: 1.0.0
paths:
  /users:
    get:
      summary: Get users
      responses:
        '200':
          description: Success
`;

const client = await UtcpClient.create();
await client.registerCallTemplate({
  call_template_type: 'text',
  name: 'my-api',
  content: openApiSpec
});
```

## Browser Usage

Perfect for web applications:

```typescript
import '@utcp/text';
import { UtcpClient } from '@utcp/sdk';

// Load from API or inline
const response = await fetch('/api/utcp-manual');
const manualContent = await response.text();

const client = await UtcpClient.create();
await client.registerCallTemplate({
  call_template_type: 'text',
  name: 'remote-manual',
  content: manualContent
});
```

## Comparison with @utcp/file

| Feature | @utcp/text | @utcp/file |
|---------|-------------|-----------|
| Browser compatible | ✅ Yes | ❌ No |
| Node.js compatible | ✅ Yes | ✅ Yes |
| File system access | ❌ No | ✅ Yes |
| Direct content | ✅ Yes | ❌ No |
| Use case | Web apps, inline content | Server-side file reading |

## License

MPL-2.0
