import { z } from 'zod';
import { ToolSchema } from './tool';

// UTCP Manual Schema
export const UtcpManualSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  version: z.string().default('1.0.0'),
  tools: z.array(ToolSchema).default([]),
});

// TypeScript type
export type UtcpManual = z.infer<typeof UtcpManualSchema>;
