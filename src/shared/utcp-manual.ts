import { z } from 'zod';
import { Tool, ToolSchema } from './tool';

// Package version from package.json
const PACKAGE_VERSION = '0.1.1';

/**
 * The response returned by a tool provider when queried for available tools 
 * (e.g. through the /utcp endpoint)
 */
export const UtcpManualSchema = z.object({
  version: z.string().default(PACKAGE_VERSION),
  tools: z.array(ToolSchema)
});

export type UtcpManual = z.infer<typeof UtcpManualSchema>;