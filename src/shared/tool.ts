import { z } from 'zod';
import { ProviderUnionSchema } from './provider';

// Tool Input/Output Schema
export const ToolInputOutputSchemaSchema = z.object({
  type: z.string().default('object'),
  properties: z.record(z.any()).default({}),
  required: z.array(z.string()).optional(),
  description: z.string().optional(),
  title: z.string().optional(),
});

// Tool Schema
export const ToolSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  inputs: ToolInputOutputSchemaSchema.default({ type: 'object', properties: {} }),
  outputs: ToolInputOutputSchemaSchema.default({ type: 'object', properties: {} }),
  tags: z.array(z.string()).default([]),
  average_response_size: z.number().optional(),
  provider: ProviderUnionSchema,
});

// TypeScript types
export type ToolInputOutputSchema = z.infer<typeof ToolInputOutputSchemaSchema>;
export type Tool = z.infer<typeof ToolSchema>;

// Tool Context class for managing tools
export class ToolContext {
  private static tools: Tool[] = [];

  static addTool(tool: Tool): void {

    this.tools.push(tool);
  }

  static getTools(): Tool[] {
    return this.tools;
  }

  static clearTools(): void {
    this.tools = [];
  }

  static findTool(name: string): Tool | undefined {
    return this.tools.find(tool => tool.name === name);
  }

  static removeToolsByProvider(providerName: string): void {
    this.tools = this.tools.filter(tool => tool.provider.name !== providerName);
  }
}

// Decorator interface for TypeScript
export interface UtcpToolOptions {
  name?: string;
  description?: string;
  tags?: string[];
  inputs?: ToolInputOutputSchema;
  outputs?: ToolInputOutputSchema;
}

// Utility function to create tool from function (similar to Python decorator)
export function createUtcpTool(
  provider: z.infer<typeof ProviderUnionSchema>,
  options: UtcpToolOptions = {},
  targetFunction: Function
): Tool {
  const toolName = options.name || targetFunction.name;
  const toolDescription = options.description || '';
  const toolTags = options.tags || ['utcp'];

  // Set provider name if not provided
  if (!provider.name) {
    provider.name = `${toolName}_provider`;
  }

  const tool: Tool = {
    name: toolName,
    description: toolDescription,
    inputs: options.inputs || { type: 'object', properties: {} },
    outputs: options.outputs || { type: 'object', properties: {} },
    tags: toolTags,
    provider: provider,
  };

  ToolContext.addTool(tool);
  return tool;
}
