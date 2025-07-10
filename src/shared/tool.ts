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
  items: z.record(z.any()).optional(),
  enum: z.array(z.any()).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  format: z.string().optional(),
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
  tool_provider: ProviderUnionSchema,
});

export type Tool = z.infer<typeof ToolSchema>;