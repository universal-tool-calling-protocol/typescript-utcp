// packages/direct-call/src/direct_call_template.ts
import { z } from 'zod';
import { CallTemplate, Serializer } from '@utcp/sdk';

/**
 * Call template for direct callable functions.
 *
 * Allows registering and calling JavaScript/TypeScript functions directly
 * as UTCP tools without the need for external APIs or file-based configurations.
 *
 * Attributes:
 *     call_template_type: Always "direct-call" for direct callable templates.
 *     callable_name: The name of the callable function to invoke.
 *     auth: Not applicable for direct calls - always undefined.
 */
export interface DirectCallTemplate extends CallTemplate {
  call_template_type: 'direct-call';
  callable_name: string;
  auth?: undefined;
  allowed_communication_protocols?: string[];
}

/**
 * Zod schema for DirectCallTemplate.
 */
export const DirectCallTemplateSchema: z.ZodType<DirectCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('direct-call'),
  callable_name: z.string().describe('The name of the callable function to invoke.'),
  auth: z.undefined().optional(),
  allowed_communication_protocols: z.array(z.string()).optional().describe('Optional list of allowed communication protocol types for tools within this manual.'),
}).strict() as z.ZodType<DirectCallTemplate>;

/**
 * Serializer for DirectCallTemplate.
 */
export class DirectCallTemplateSerializer extends Serializer<DirectCallTemplate> {
  /**
   * Convert a DirectCallTemplate to a dictionary.
   */
  toDict(obj: DirectCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      callable_name: obj.callable_name,
      auth: obj.auth,
      allowed_communication_protocols: obj.allowed_communication_protocols,
    };
  }

  /**
   * Validate and convert a dictionary to a DirectCallTemplate.
   */
  validateDict(obj: Record<string, unknown>): DirectCallTemplate {
    try {
      return DirectCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid DirectCallTemplate: ${e.message}\n${e.stack || ''}`);
    }
  }
}
