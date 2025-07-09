import { z } from 'zod';
import { ProviderUnion, ProviderUnionSchema } from './provider';

/**
 * Schema for defining tool input and output schemas
 */
export const ToolInputOutputSchema = z.object({
  type: z.string().default('object'),
  properties: z.record(z.any()).default({}),
  required: z.array(z.string()).optional(),
  description: z.string().optional(),
  title: z.string().optional(),
});

export type ToolInputOutputSchema = z.infer<typeof ToolInputOutputSchema>;

/**
 * Schema for a UTCP Tool
 */
export const ToolSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  inputs: ToolInputOutputSchema.default({}),
  outputs: ToolInputOutputSchema.default({}),
  tags: z.array(z.string()).default([]),
  average_response_size: z.number().optional(),
  provider: ProviderUnionSchema,
});

export type Tool = z.infer<typeof ToolSchema>;

/**
 * Context for managing tools in the UTCP server
 */
export class ToolContext {
  private static _tools: Tool[] = [];

  /**
   * Add a tool to the UTCP server
   * @param tool The tool to add
   */
  static addTool(tool: Tool): void {
    console.log(`Adding tool: ${tool.name} with provider: ${tool.provider?.name || 'None'}`);
    ToolContext._tools.push(tool);
  }

  /**
   * Get all tools available in the UTCP server
   * @returns List of available tools
   */
  static getTools(): Tool[] {
    return ToolContext._tools;
  }
}

/**
 * Function type for UTCP tools
 */
export type ToolFunction<TInput = any, TOutput = any> = (input: TInput) => Promise<TOutput> | TOutput;

/**
 * Tool function with additional properties
 */
export interface EnhancedToolFunction<TInput = any, TOutput = any> extends ToolFunction<TInput, TOutput> {
  input: () => ToolInputOutputSchema;
  output: () => ToolInputOutputSchema;
  tool_definition: () => Tool;
}

/**
 * Options for creating a UTCP tool
 */
export interface UtcpToolOptions {
  provider: ProviderUnion;
  name?: string;
  description?: string;
  tags?: string[];
  inputs?: ToolInputOutputSchema;
  outputs?: ToolInputOutputSchema;
}

/**
 * Create a UTCP tool
 * This is the TypeScript equivalent of the Python @utcp_tool decorator
 * 
 * @param options Tool configuration options
 * @returns A decorator function that enhances a function to be a UTCP tool
 */
export function utcpTool<TInput = any, TOutput = any>(
  options: UtcpToolOptions
): (func: ToolFunction<TInput, TOutput>) => EnhancedToolFunction<TInput, TOutput> {
  return function(func: ToolFunction<TInput, TOutput>): EnhancedToolFunction<TInput, TOutput> {
    // Ensure provider has a name
    if (!options.provider.name) {
      const _providerName = `${func.name}_provider`;
      options.provider.name = _providerName;
    }

    const funcName = options.name || func.name;
    const funcDescription = options.description || func.toString() || '';

    // Create default input schema if not provided
    // Note: TypeScript doesn't have runtime type reflection like Python's get_type_hints,
    // so we'll need to provide input schemas explicitly or use TypeScript reflection libraries
    const inputToolSchema: ToolInputOutputSchema = options.inputs || {
      type: 'object',
      properties: {},
      required: [],
      title: funcName,
      description: funcDescription
    };

    // Create default output schema if not provided
    const outputToolSchema: ToolInputOutputSchema = options.outputs || {
      type: 'object', 
      properties: {},
      required: [],
      title: funcName,
      description: funcDescription
    };

    // Create the complete tool definition
    const getToolDefinition = (): Tool => ({
      name: funcName,
      description: funcDescription,
      tags: options.tags || ['utcp'],
      inputs: inputToolSchema,
      outputs: outputToolSchema,
      provider: options.provider
    });

    // Add the tool to the UTCP manual context
    ToolContext.addTool(getToolDefinition());

    // Enhance the function with UTCP tool properties
    const enhancedFunc = func as EnhancedToolFunction<TInput, TOutput>;
    enhancedFunc.input = () => inputToolSchema;
    enhancedFunc.output = () => outputToolSchema;
    enhancedFunc.tool_definition = getToolDefinition;

    return enhancedFunc;
  };
}
