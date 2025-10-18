// packages/core/src/data/utcp_manual.ts
import { z } from 'zod';
import { ToolSchema, Tool } from '@utcp/core/data/tool';
import { Serializer } from '../interfaces/serializer';
import { LIB_VERSION } from '../version';

/**
 * The default UTCP protocol version used throughout the library.
 * This is replaced at build time with the actual package version.
 * Use this constant when creating UtcpManual objects to ensure version consistency.
 */
export const UTCP_PACKAGE_VERSION = LIB_VERSION;

/**
 * Interface for the standard format for tool provider responses during discovery.
 * Represents the complete set of tools available from a provider, along
 * with version information for compatibility checking.
 */
export interface UtcpManual {
  /**
   * The UTCP protocol version supported by the provider.
   */
  utcp_version: string;

  /**
   * The version of this specific manual/specification.
   */
  manual_version: string;

  /**
   * List of available tools with their complete configurations.
   */
  tools: Tool[];
}

/**
 * The standard format for tool provider responses during discovery.
 * This schema is used for runtime validation and parsing of UTCP manuals.
 */
export const UtcpManualSchema: z.ZodType<UtcpManual> = z.object({
  // Use .optional() to allow missing in input, then .default() to satisfy the interface.
  utcp_version: z.string().optional().default(UTCP_PACKAGE_VERSION)
    .describe('UTCP protocol version supported by the provider.'),
  manual_version: z.string().optional().default('1.0.0')
    .describe('Version of this specific manual.'),
  tools: z.array(ToolSchema)
    .describe('List of available tools with their complete configurations.'),
}).strict() as z.ZodType<UtcpManual>;

/**
 * Serializer for UtcpManual objects.
 * Handles serialization and deserialization of complete UTCP manual definitions.
 */
export class UtcpManualSerializer extends Serializer<UtcpManual> {
  toDict(obj: UtcpManual): Record<string, unknown> {
    return {
      utcp_version: obj.utcp_version,
      manual_version: obj.manual_version,
      tools: obj.tools,
    };
  }

  validateDict(obj: Record<string, unknown>): UtcpManual {
    return UtcpManualSchema.parse(obj);
  }
}