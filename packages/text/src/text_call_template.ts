// packages/text/src/text_call_template.ts
import { z } from 'zod';
import { CallTemplate } from '@utcp/core/data/call_template';
import { Auth, AuthSchema, AuthSerializer } from '@utcp/core/data/auth';
import { Serializer } from '@utcp/core/interfaces/serializer';

/**
 * REQUIRED
 * Call template for text file-based manuals and tools.
 *
 * Reads UTCP manuals or tool definitions from local JSON/YAML files. Useful for
 * static tool configurations or environments where manuals are distributed as files.
 *
 * Attributes:
 *     call_template_type: Always "text" for text file call templates.
 *     file_path: Path to the file containing the UTCP manual or tool definitions.
 *     auth: Always None - text call templates don't support authentication for file access.
 *     auth_tools: Optional authentication to apply to generated tools from OpenAPI specs.
 */
export interface TextCallTemplate extends CallTemplate {
  call_template_type: 'text';
  file_path: string;
  auth?: undefined;
  auth_tools?: Auth | null;
}

/**
 * Zod schema for TextCallTemplate.
 */
export const TextCallTemplateSchema: z.ZodType<TextCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('text'),
  file_path: z.string().describe('The path to the file containing the UTCP manual or tool definitions.'),
  auth: z.undefined().optional(),
  auth_tools: AuthSchema.nullable().optional().transform((val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && 'auth_type' in val) {
      return new AuthSerializer().validateDict(val as any);
    }
    return val as Auth;
  }).describe('Authentication to apply to generated tools from OpenAPI specs.'),
}).strict() as z.ZodType<TextCallTemplate>;

/**
 * REQUIRED
 * Serializer for TextCallTemplate.
 */
export class TextCallTemplateSerializer extends Serializer<TextCallTemplate> {
  /**
   * REQUIRED
   * Convert a TextCallTemplate to a dictionary.
   */
  toDict(obj: TextCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      file_path: obj.file_path,
      auth: obj.auth,
      auth_tools: obj.auth_tools ? new AuthSerializer().toDict(obj.auth_tools) : null,
    };
  }

  /**
   * REQUIRED
   * Validate and convert a dictionary to a TextCallTemplate.
   */
  validateDict(obj: Record<string, unknown>): TextCallTemplate {
    try {
      return TextCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid TextCallTemplate: ${e.message}\n${e.stack || ''}`);
    }
  }
}