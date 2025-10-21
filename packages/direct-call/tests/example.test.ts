/**
 * Example test file demonstrating usage of the direct-call plugin.
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { UtcpClient, CommunicationProtocol } from '@utcp/sdk';
import { addFunctionToUtcpDirectCall, registerCallable, DirectCallTemplate } from '../src';
import type { UtcpManual } from '@utcp/sdk';

// Example: Using addFunctionToUtcpDirectCall to register a function that returns a manual
const getTestManual = addFunctionToUtcpDirectCall('testManual', async (): Promise<UtcpManual> => {
  return {
    utcp_version: '1.0.0',
    manual_version: '1.0.0',
    tools: [
      {
        name: 'greet',
        description: 'Greets a person',
        inputs: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' }
          },
          required: ['name']
        },
        outputs: {
          type: 'string',
          description: 'Greeting message'
        },
        tags: [],
        tool_call_template: {
          call_template_type: 'direct-call',
          callable_name: 'greet'
        }
      },
      {
        name: 'add',
        description: 'Adds two numbers',
        inputs: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' }
          },
          required: ['a', 'b']
        },
        outputs: {
          type: 'number',
          description: 'Sum of the two numbers'
        },
        tags: [],
        tool_call_template: {
          call_template_type: 'direct-call',
          callable_name: 'add'
        }
      }
    ]
  };
});

// Example: Using addFunctionToUtcpDirectCall to register tool functions
const greetTool = addFunctionToUtcpDirectCall('greet', async (name: string): Promise<string> => {
  return `Hello, ${name}!`;
});

const addTool = addFunctionToUtcpDirectCall('add', async (a: number, b: number): Promise<number> => {
  return a + b;
});

describe('Direct Call Plugin', () => {
  let client: UtcpClient;

  beforeAll(async () => {
    client = await UtcpClient.create(process.cwd());
  });

  test('should register manual from callable', async () => {
    const callTemplate: DirectCallTemplate = {
      name: 'testManual',
      call_template_type: 'direct-call',
      callable_name: 'testManual'
    };

    const result = await client.registerManual(callTemplate);
    
    expect(result.success).toBe(true);
    expect(result.manual).toBeDefined();
    expect(result.manual.tools.length).toBe(2);
  });

  test('should call tool via client - greet', async () => {
    // After registering the manual, tools are available by their full name
    const result = await client.callTool('testManual.greet', { name: 'Alice' });
    
    expect(result).toBe('Hello, Alice!');
  });

  test('should call tool via client - add', async () => {
    // After registering the manual, tools are available by their full name
    const result = await client.callTool('testManual.add', { a: 5, b: 3 });
    
    expect(result).toBe(8);
  });

  test('should call protocol directly via call template', async () => {
    // Register a callable manually
    registerCallable('manualTool', async (value: number) => {
      return value * 2;
    });

    const callTemplate: DirectCallTemplate = {
      name: 'manualTool',
      call_template_type: 'direct-call',
      callable_name: 'manualTool'
    };

    // Get the protocol and call it directly
    const protocol = CommunicationProtocol.communicationProtocols['direct-call'];
    const result = await protocol.callTool(client, 'manualTool', { value: 21 }, callTemplate);
    
    expect(result).toBe(42);
  });

  test('should handle streaming', async () => {
    // Register a streaming callable
    registerCallable('streamingTool', async function* (count: number) {
      for (let i = 0; i < count; i++) {
        yield i;
      }
    });

    const callTemplate: DirectCallTemplate = {
      name: 'streamingTool',
      call_template_type: 'direct-call',
      callable_name: 'streamingTool'
    };

    const chunks: number[] = [];
    // Get the protocol and call streaming directly
    const protocol = CommunicationProtocol.communicationProtocols['direct-call'];
    for await (const chunk of protocol.callToolStreaming(client, 'streamingTool', { count: 5 }, callTemplate)) {
      chunks.push(chunk);
    }
    
    expect(chunks).toEqual([0, 1, 2, 3, 4]);
  });
});
