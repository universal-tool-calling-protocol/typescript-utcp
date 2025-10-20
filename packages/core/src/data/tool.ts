// packages/core/src/data/tool.ts
import { z } from 'zod';
import { CallTemplate, CallTemplateSchema } from './call_template';
import { Serializer } from '../interfaces/serializer';

// Define a recursive type for basic JSON values
/**
 * A recursive type representing any valid JSON value: string, number, boolean, null, object, or array.
 */
type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

// --- JSON Schema Typing and Validation ---

/**
 * Zod type for basic JSON primitive or recursive structure.
 */
export const JsonTypeSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.string(), JsonTypeSchema),
  z.array(JsonTypeSchema),
]));
export type JsonType = z.infer<typeof JsonTypeSchema>;


/**
 * Interface for a JSON Schema definition (based on draft-07).
 * This defines the structure for tool inputs and outputs.
 */
export interface JsonSchema {
  /**
   * Optional schema identifier.
   */
  $schema?: string;
  /**
   * Optional schema identifier.
   */
  $id?: string;
  /**
   * Optional schema title.
   */
  title?: string;
  /**
   * Optional schema description.
   */
  description?: string;
  /**
   * The JSON data type (e.g., 'object', 'string', 'number').
   */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null' | string[];
  /**
   * Defines properties if type is 'object'.
   */
  properties?: { [key: string]: JsonSchema };
  /**
   * Defines item structure if type is 'array'.
   */
  items?: JsonSchema | JsonSchema[];
  /**
   * List of required properties if type is 'object'.
   */
  required?: string[];
  /**
   * List of allowable values.
   */
  enum?: JsonType[];
  /**
   * The exact required value.
   */
  const?: JsonType;
  /**
   * A default value for the property.
   */
  default?: JsonType;
  /**
   * Optional format hint (e.g., 'date-time', 'email').
   */
  format?: string;
  /**
   * Allows or specifies schema for additional properties.
   */
  additionalProperties?: boolean | JsonSchema;
  /**
   * Regex pattern for string validation.
   */
  pattern?: string;
  /**
   * Minimum numeric value.
   */
  minimum?: number;
  /**
   * Maximum numeric value.
   */
  maximum?: number;
  /**
   * Minimum string length.
   */
  minLength?: number;
  /**
   * Maximum string length.
   */
  maxLength?: number;
  [k: string]: unknown;
}


/**
 * Zod schema corresponding to the JsonSchema interface.
 */
export const JsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() => z.object({
  $schema: z.string().optional().describe('JSON Schema version URI.'),
  $id: z.string().optional().describe('A URI for the schema.'),
  title: z.string().optional().describe('A short explanation about the purpose of the data described by this schema.'),
  description: z.string().optional().describe('A more lengthy explanation about the purpose of the data described by this schema.'),
  type: z.union([
    z.literal('string'), z.literal('number'), z.literal('integer'), z.literal('boolean'),
    z.literal('object'), z.literal('array'), z.literal('null'), z.array(z.string())
  ]).optional(),
  properties: z.record(z.string(), z.lazy(() => JsonSchemaSchema)).optional(),
  items: z.union([z.lazy(() => JsonSchemaSchema), z.array(z.lazy(() => JsonSchemaSchema))]).optional(),
  required: z.array(z.string()).optional(),
  enum: z.array(JsonTypeSchema).optional(),
  const: JsonTypeSchema.optional(),
  default: JsonTypeSchema.optional(),
  format: z.string().optional(),
  additionalProperties: z.union([z.boolean(), z.lazy(() => JsonSchemaSchema)]).optional(),
  pattern: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
}).catchall(z.unknown()));


// --- Tool Typing and Validation ---

/**
 * Interface for a UTCP Tool.
 * Represents a callable tool with its metadata, input/output schemas,
 * and associated call template. Tools are the fundamental units of
 * functionality in the UTCP ecosystem.
 */
export interface Tool {
  /**
   * Unique identifier for the tool, typically in format "manual_name.tool_name".
   */
  name: string;
  /**
   * Human-readable description of what the tool does.
   */
  description: string;
  /**
   * JSON Schema defining the tool's input parameters.
   */
  inputs: JsonSchema;
  /**
   * JSON Schema defining the tool's return value structure.
   */
  outputs: JsonSchema;
  /**
   * List of tags for categorization and search.
   */
  tags: string[];
  /**
   * Optional hint about typical response size in bytes.
   */
  average_response_size?: number;
  /**
   * CallTemplate configuration for accessing this tool.
   */
  tool_call_template: CallTemplate;
}

/**
 * Zod schema corresponding to the Tool interface.
 */
export const ToolSchema: z.ZodType<Tool> = z.object({
  name: z.string().describe('Unique identifier for the tool, typically in format "manual_name.tool_name".'),
  description: z.string().default('').describe('Human-readable description of what the tool does.'),
  inputs: JsonSchemaSchema.default({}).describe('JSON Schema defining the tool\'s input parameters.'),
  outputs: JsonSchemaSchema.default({}).describe('JSON Schema defining the tool\'s return value structure.'),
  tags: z.array(z.string()).default([]).describe('List of tags for categorization and search.'),
  average_response_size: z.number().optional().describe('Optional hint about typical response size in bytes.'),
  tool_call_template: CallTemplateSchema.describe('CallTemplate configuration for accessing this tool.'),
}).strict() as z.ZodType<Tool>;

/**
 * Serializer for JsonSchema objects.
 * Since JsonSchema is a standard format without subtypes, this is a simple passthrough serializer.
 */
export class JsonSchemaSerializer extends Serializer<JsonSchema> {
  toDict(obj: JsonSchema): Record<string, unknown> {
    return { ...obj };
  }

  validateDict(obj: Record<string, unknown>): JsonSchema {
    return JsonSchemaSchema.parse(obj);
  }
}

/**
 * Serializer for Tool objects.
 * Handles serialization and deserialization of complete tool definitions.
 */
export class ToolSerializer extends Serializer<Tool> {
  toDict(obj: Tool): Record<string, unknown> {
    return {
      name: obj.name,
      description: obj.description,
      inputs: obj.inputs,
      outputs: obj.outputs,
      tags: obj.tags,
      ...(obj.average_response_size !== undefined && { average_response_size: obj.average_response_size }),
      tool_call_template: obj.tool_call_template,
    };
  }

  validateDict(obj: Record<string, unknown>): Tool {
    return ToolSchema.parse(obj);
  }
}