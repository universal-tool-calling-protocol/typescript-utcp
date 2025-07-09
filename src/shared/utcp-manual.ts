import { z } from 'zod';
import { Tool, ToolSchema, ToolContext } from './tool';

// Package version from package.json
const PACKAGE_VERSION = '0.1.0';

/**
 * The response returned by a tool provider when queried for available tools 
 * (e.g. through the /utcp endpoint)
 */
export const UtcpManualSchema = z.object({
  version: z.string().default(PACKAGE_VERSION),
  tools: z.array(ToolSchema)
});

export type UtcpManual = z.infer<typeof UtcpManualSchema>;

/**
 * Utility functions for creating and working with UTCP Manuals
 */
export class UtcpManualUtils {
  /**
   * Get the UTCP manual with version and tools
   * @param version Optional version override
   * @returns A new UtcpManual instance
   */
  static create(version: string = PACKAGE_VERSION): UtcpManual {
    return {
      version,
      tools: ToolContext.getTools()
    };
  }
}
