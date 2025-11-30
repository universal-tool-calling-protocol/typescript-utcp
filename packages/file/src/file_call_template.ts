// packages/file/src/file_call_template.ts
import { z } from 'zod';
import { CallTemplate } from '@utcp/sdk';
import { Auth, AuthSchema, AuthSerializer } from '@utcp/sdk';
import { Serializer } from '@utcp/sdk';

/**
 * REQUIRED
 * Call template for file-based manuals and tools.
 *
 * Reads UTCP manuals or tool definitions from local JSON/YAML files.
 * Useful for static tool configurations or environments where manuals are distributed as files.
 * For direct text content, use @utcp/text instead.
 *
 * Attributes:
 *     call_template_type: Always "file" for file call templates.
 *     file_path: Path to the file containing the UTCP manual or tool definitions (required).
 *     auth: Always undefined - file call templates don't support authentication for file access.
 *     auth_tools: Optional authentication to apply to generated tools from OpenAPI specs.
 */
export interface FileCallTemplate extends CallTemplate {
  call_template_type: 'file';
  file_path: string;
  auth?: undefined;
  auth_tools?: Auth | null;
  allowed_communication_protocols?: string[];
}

/**
 * Zod schema for FileCallTemplate.
 */
export const FileCallTemplateSchema: z.ZodType<FileCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('file'),
  file_path: z.string().describe('The path to the file containing the UTCP manual or tool definitions.'),
  auth: z.undefined().optional(),
  auth_tools: AuthSchema.nullable().optional().transform((val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && 'auth_type' in val) {
      return new AuthSerializer().validateDict(val as any);
    }
    return val as Auth;
  }).describe('Authentication to apply to generated tools from OpenAPI specs.'),
  allowed_communication_protocols: z.array(z.string()).optional().describe('Optional list of allowed communication protocol types for tools within this manual.'),
}).strict() as z.ZodType<FileCallTemplate>;

/**
 * REQUIRED
 * Serializer for FileCallTemplate.
 */
export class FileCallTemplateSerializer extends Serializer<FileCallTemplate> {
  /**
   * REQUIRED
   * Convert a FileCallTemplate to a dictionary.
   */
  toDict(obj: FileCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      file_path: obj.file_path,
      auth: obj.auth,
      auth_tools: obj.auth_tools ? new AuthSerializer().toDict(obj.auth_tools) : null,
      allowed_communication_protocols: obj.allowed_communication_protocols,
    };
  }

  /**
   * REQUIRED
   * Validate and convert a dictionary to a FileCallTemplate.
   */
  validateDict(obj: Record<string, unknown>): FileCallTemplate {
    try {
      return FileCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid FileCallTemplate: ${e.message}\n${e.stack || ''}`);
    }
  }
}
