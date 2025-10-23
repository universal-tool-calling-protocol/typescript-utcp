// packages/text/src/text_call_template.ts
import { z } from 'zod';
import { CallTemplate, Auth, AuthSchema, AuthSerializer } from '@utcp/sdk';
import { Serializer } from '@utcp/sdk';

/**
 * Text call template for UTCP client.
 *
 * This template allows passing UTCP manuals or tool definitions directly as text content.
 * It supports both JSON and YAML formats and can convert OpenAPI specifications to UTCP manuals.
 *
 * Attributes:
 *     call_template_type: Always "text" for text call templates.
 *     content: Direct text content of the UTCP manual or tool definitions (required).
 *     auth: Always undefined - text call templates don't support authentication.
 *     auth_tools: Optional authentication to apply to generated tools from OpenAPI specs.
 */
export interface TextCallTemplate extends CallTemplate {
  call_template_type: 'text';
  content: string;
  auth?: undefined;
  auth_tools?: Auth | null;
}

/**
 * Zod schema for TextCallTemplate.
 */
export const TextCallTemplateSchema: z.ZodType<TextCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('text'),
  content: z.string().describe('Direct text content of the UTCP manual or tool definitions'),
  auth: z.undefined().optional(),
  auth_tools: AuthSchema.nullable().optional().transform((val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && 'auth_type' in val) {
      return new AuthSerializer().validateDict(val as any);
    }
    return val as Auth;
  }).describe('Optional authentication to apply to generated tools from OpenAPI specs'),
}).strict() as z.ZodType<TextCallTemplate>;

/**
 * Serializer for TextCallTemplate objects.
 */
export class TextCallTemplateSerializer extends Serializer<TextCallTemplate> {
  toDict(obj: TextCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      content: obj.content,
      auth: obj.auth,
      auth_tools: obj.auth_tools ? new AuthSerializer().toDict(obj.auth_tools) : null,
    };
  }

  validateDict(obj: Record<string, unknown>): TextCallTemplate {
    try {
      return TextCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid TextCallTemplate: ${e.message}\n${e.stack || ''}`);
    }
  }
}
