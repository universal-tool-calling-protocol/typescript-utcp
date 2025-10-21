# @utcp/direct-call

Direct callable functions plugin for UTCP (Universal Tool Calling Protocol).

This plugin allows you to register and call JavaScript/TypeScript functions directly as UTCP tools, without the need for external APIs or file-based configurations.

## Features

- **Direct Function Calls**: Register JavaScript/TypeScript functions as UTCP tools
- **Simple Registration**: Use `addFunctionToUtcpDirectCall()` to register functions at the global level
- **Type-Safe**: Full TypeScript support with proper type definitions
- **Streaming Support**: Built-in support for streaming responses

## Installation

```bash
npm install @utcp/direct-call
```

## Usage

**Important:** When UTCP calls your registered functions, it spreads the toolArgs object properties as separate parameters. For example, if toolArgs is `{ name: 'Alice', age: 30 }`, your function will be called as `yourFunction('Alice', 30)`, not `yourFunction({ name: 'Alice', age: 30 })`.

### Using `addFunctionToUtcpDirectCall`

```typescript
import { addFunctionToUtcpDirectCall } from '@utcp/direct-call';
import { UtcpManual } from '@utcp/sdk';

// Register a function that returns a UTCP manual
const getMyManual = addFunctionToUtcpDirectCall('myManual', async (): Promise<UtcpManual> => {
  return {
    utcp_version: '1.0.0',
    manual_version: '1.0.0',
    tools: [
      {
        name: 'exampleTool',
        description: 'An example tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: [],
        tool_call_template: {
          call_template_type: 'direct-call',
          callable_name: 'exampleTool'
        }
      }
    ]
  };
});

// Register a tool function
const myTool = addFunctionToUtcpDirectCall('exampleTool', async (...args: any[]): Promise<any> => {
  return { result: 'Hello from direct call!' };
});

// You can also use named functions
// Note: Parameters are spread from the toolArgs object
async function greet(name: string) {
  return `Hello, ${name}!`;
}
addFunctionToUtcpDirectCall('greet', greet);
```

### Manual Registration

```typescript
import { DirectCommunicationProtocol } from '@utcp/direct-call';
import { UtcpManual } from '@utcp/sdk';

const protocol = new DirectCommunicationProtocol();

// Register a callable for returning manuals
protocol.registerCallable('myManual', async () => {
  return {
    utcp_version: '1.0.0',
    manual_version: '1.0.0',
    tools: []
  } as UtcpManual;
});

// Register a callable for tool execution
protocol.registerCallable('myTool', async (args: any) => {
  return { result: 'Success!' };
});
```

## License

MPL-2.0
