// packages/text/src/text_call_template.ts
import { z } from 'zod';
import { CallTemplate } from '@utcp/sdk';
import { Auth, AuthSchema, AuthSerializer } from '@utcp/sdk';
import { Serializer } from '@utcp/sdk';

/**
 * REQUIRED
 * Call template for text-based manuals and tools.
 *
 * Supports both reading UTCP manuals or tool definitions from local JSON/YAML files
 * or directly from string content. Useful for static tool configurations or environments
 * where manuals are distributed as files or dynamically generated strings.
 *
 * Attributes:
 *     call_template_type: Always "text" for text call templates.
 *     file_path: Path to the file containing the UTCP manual or tool definitions (optional if content is provided).
 *     content: Direct string content of the UTCP manual or tool definitions (optional if file_path is provided).
 *     auth: Always None - text call templates don't support authentication for file access.
 *     auth_tools: Optional authentication to apply to generated tools from OpenAPI specs.
 *
 * Note: At least one of file_path or content must be provided. If both are provided, content takes precedence.
 */
export interface TextCallTemplate extends CallTemplate {
  call_template_type: 'text';
  file_path?: string;
  content?: string;
  auth?: undefined;
  auth_tools?: Auth | null;
}

/**
 * Zod schema for TextCallTemplate.
 */
export const TextCallTemplateSchema: z.ZodType<TextCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('text'),
  file_path: z.string().optional().describe('The path to the file containing the UTCP manual or tool definitions.'),
  content: z.string().optional().describe('Direct string content of the UTCP manual or tool definitions.'),
  auth: z.undefined().optional(),
  auth_tools: AuthSchema.nullable().optional().transform((val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && 'auth_type' in val) {
      return new AuthSerializer().validateDict(val as any);
    }
    return val as Auth;
  }).describe('Authentication to apply to generated tools from OpenAPI specs.'),
}).strict().refine(
  (data) => data.file_path !== undefined || data.content !== undefined,
  { message: 'Either file_path or content must be provided' }
) as z.ZodType<TextCallTemplate>;

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
      content: obj.content,
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