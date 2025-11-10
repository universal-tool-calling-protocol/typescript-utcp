# @utcp/code-mode

A powerful extension for UTCP that enables executing TypeScript code with direct access to all registered tools as native TypeScript functions.

## Features

- **TypeScript Code Execution**: Execute TypeScript code snippets with full access to registered tools
- **Hierarchical Tool Access**: Tools organized by manual namespace (e.g., `math_tools.add()`)
- **Hierarchical Type Definitions**: TypeScript interfaces organized in namespaces matching tool structure
- **Runtime Interface Access**: Access TypeScript interfaces at runtime for introspection
- **Type Safety**: Generates proper TypeScript interfaces for all tool inputs and outputs
- **Secure Execution**: Uses Node.js VM module for safe code execution with timeout support
- **Chain Tool Calls**: Combine multiple tool calls in a single TypeScript code block

## Installation

```bash
npm install @utcp/code-mode
```

## Basic Usage

```typescript
import { CodeModeUtcpClient } from '@utcp/code-mode';

const client = await CodeModeUtcpClient.create();

// Register some tools first (example)
await client.registerManual({
  name: 'math_tools',
  call_template_type: 'text',
  content: `
    name: add
    description: Adds two numbers
    inputs:
      type: object
      properties:
        a: { type: number }
        b: { type: number }
      required: [a, b]
    outputs:
      type: object
      properties:
        result: { type: number }
  `
});

// Now execute TypeScript code that uses the tools
const { result, logs } = await client.callToolChain(`
  // Call the add tool using hierarchical access
  const sum1 = await math_tools.add({ a: 5, b: 3 });
  console.log('First sum:', sum1.result);
  
  // Chain multiple tool calls
  const sum2 = await math_tools.add({ a: sum1.result, b: 10 });
  console.log('Second sum:', sum2.result);
  
  // Access TypeScript interfaces at runtime
  const addInterface = __getToolInterface('math_tools.add');
  console.log('Add tool interface:', addInterface);
  
  // Return final result
  return sum2.result;
`);

console.log('Final result:', result); // 18
console.log('Console output:', logs); // ['First sum: 8', 'Second sum: 18', 'Add tool interface: ...']
```

## Advanced Usage

### Console Output Capture

All console output is automatically captured and returned alongside execution results:

```typescript
const { result, logs } = await client.callToolChain(`
  console.log('Starting calculation...');
  console.error('This will show as [ERROR]');
  console.warn('This will show as [WARN]');
  
  const sum1 = await math_tools.add({ a: 5, b: 3 });
  console.log('First sum:', sum1.result);
  
  const sum2 = await math_tools.add({ a: sum1.result, b: 10 });
  console.log('Final sum:', sum2.result);
  
  return sum2.result;
`);

console.log('Result:', result); // 18
console.log('Captured logs:');
logs.forEach((log, i) => console.log(`${i + 1}: ${log}`));
// Output:
// 1: Starting calculation...
// 2: [ERROR] This will show as [ERROR]
// 3: [WARN] This will show as [WARN]
// 4: First sum: 8
// 5: Final sum: 18
```

### Getting TypeScript Interfaces

You can generate TypeScript interfaces for all your tools to get better IDE support:

```typescript
const interfaces = await client.getAllToolsTypeScriptInterfaces();
console.log(interfaces);
```

This will output something like:

```typescript
// Auto-generated TypeScript interfaces for UTCP tools

namespace math_tools {
  interface addInput {
    /** First number */
    a: number;
    /** Second number */
    b: number;
  }

  interface addOutput {
    /** The sum result */
    result: number;
  }
}

/**
 * Adds two numbers
 * Tags: math, arithmetic
 * Access as: math_tools.add(args)
 */
```

### Complex Tool Chains

Execute complex logic with multiple tools using hierarchical access:

```typescript
const result = await client.callToolChain(`
  // Get user data (assuming 'user_service' manual)
  const user = await user_service.getUserData({ userId: "123" });
  
  // Process the data (assuming 'data_processing' manual)
  const processedData = await data_processing.processUserData({
    userData: user,
    options: { normalize: true, validate: true }
  });
  
  // Generate report (assuming 'reporting' manual)
  const report = await reporting.generateReport({
    data: processedData,
    format: "json",
    includeMetrics: true
  });
  
  // Send notification (assuming 'notifications' manual)
  await notifications.sendNotification({
    recipient: user.email,
    subject: "Your report is ready",
    body: \`Report generated with \${report.metrics.totalItems} items\`
  });
  
  return {
    reportId: report.id,
    itemCount: report.metrics.totalItems,
    notificationSent: true
  };
`);
```

### Error Handling

The code execution includes proper error handling:

```typescript
try {
  const result = await client.callToolChain(`
    const result = await someToolThatMightFail({ input: "test" });
    return result;
  `);
} catch (error) {
  console.error('Code execution failed:', error.message);
}
```

### Timeout Configuration

You can set custom timeouts for code execution:

```typescript
const result = await client.callToolChain(`
  // Long running operation
  const result = await processLargeDataset({ data: largeArray });
  return result;
`, 60000); // 60 second timeout
```

### Runtime Interface Access

The code execution context provides access to TypeScript interfaces at runtime:

```typescript
const result = await client.callToolChain(`
  // Access all interfaces
  console.log('All interfaces:', __interfaces);
  
  // Get interface for a specific tool
  const addInterface = __getToolInterface('math_tools.add');
  console.log('Add tool interface:', addInterface);
  
  // Parse interface information
  const hasNamespaces = __interfaces.includes('namespace math_tools');
  const availableNamespaces = __interfaces.match(/namespace \\w+/g) || [];
  
  // Use this for dynamic validation, documentation, or debugging
  return {
    hasInterfaces: typeof __interfaces === 'string',
    namespaceCount: availableNamespaces.length,
    canIntrospect: typeof __getToolInterface === 'function',
    specificToolInterface: !!addInterface
  };
`);
```

#### Available Context Variables

- **`__interfaces`**: String containing all TypeScript interface definitions
- **`__getToolInterface(toolName: string)`**: Function to get interface for a specific tool

## AI Agent Integration

For AI agents that will use CodeModeUtcpClient, include the built-in prompt template in your system prompt:

```typescript
import { CodeModeUtcpClient } from '@utcp/code-mode';

// Add this to your AI agent's system prompt
const systemPrompt = `
You are an AI assistant with access to tools via UTCP CodeMode.

${CodeModeUtcpClient.AGENT_PROMPT_TEMPLATE}

Additional instructions...
`;
```

This template provides essential guidance on:
- **Tool Discovery Workflow**: How to explore available tools before coding
- **Hierarchical Access Patterns**: Using `manual.tool()` syntax correctly  
- **Interface Introspection**: Leveraging `__interfaces` and `__getToolInterface()`
- **Best Practices**: Error handling, data flow, and proper code structure
- **Runtime Context**: Available variables and functions in the execution environment

## API Reference

### CodeModeUtcpClient

Extends `UtcpClient` with additional code execution capabilities.

#### Methods

##### `callToolChain(code: string, timeout?: number): Promise<{result: any, logs: string[]}>`

Executes TypeScript code with access to all registered tools and captures console output.

- **code**: TypeScript code to execute
- **timeout**: Optional timeout in milliseconds (default: 30000)
- **Returns**: Object containing both the execution result and captured console logs (`console.log`, `console.error`, `console.warn`, `console.info`)

##### `toolToTypeScriptInterface(tool: Tool): string`

Converts a single tool to its TypeScript interface definition.

- **tool**: The Tool object to convert
- **Returns**: TypeScript interface as a string

##### `getAllToolsTypeScriptInterfaces(): Promise<string>`

Generates TypeScript interfaces for all registered tools.

- **Returns**: Complete TypeScript interface definitions

### Static Properties

##### `CodeModeUtcpClient.AGENT_PROMPT_TEMPLATE: string`

A comprehensive prompt template designed for AI agents using CodeModeUtcpClient. Contains detailed guidance on tool discovery, hierarchical access patterns, interface introspection, and best practices for code execution.

### Static Methods

##### `CodeModeUtcpClient.create(root_dir?: string, config?: UtcpClientConfig): Promise<CodeModeUtcpClient>`

Creates a new CodeModeUtcpClient instance.

- **root_dir**: Root directory for relative path resolution
- **config**: UTCP client configuration
- **Returns**: New CodeModeUtcpClient instance

## Security Considerations

- Code execution happens in a secure Node.js VM context
- No access to Node.js modules or filesystem by default
- Timeout protection prevents infinite loops
- Only registered tools are accessible in the execution context

## Type Safety

The code mode client generates hierarchical TypeScript interfaces for all tools, providing:

- **Namespace Organization**: Tools grouped by manual (e.g., `namespace math_tools`)
- **Hierarchical Access**: Clean dot notation (`math_tools.add()`) prevents naming conflicts
- **Compile-time Type Checking**: Full type safety for tool parameters and return values
- **IntelliSense Support**: Enhanced IDE autocompletion with organized namespaces
- **Runtime Introspection**: Access interface definitions during code execution
- **Self-Documenting Code**: Generated interfaces include descriptions and access patterns

## Integration with IDEs

For the best development experience:

1. Generate TypeScript interfaces for your tools
2. Save them to a `.d.ts` file in your project
3. Reference the file in your TypeScript configuration
4. Enjoy full IntelliSense support for tool functions

```typescript
// Generate and save interfaces
const interfaces = await client.getAllToolsTypeScriptInterfaces();
await fs.writeFile('tools.d.ts', interfaces);
```

## License

MPL-2.0
