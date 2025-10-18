// packages/http/src/streamable_http_call_template.ts
import { z } from 'zod';
import { Auth, AuthSchema } from '@utcp/core/data/auth';
import { CallTemplate } from '@utcp/core/data/call_template';
import { Serializer } from '@utcp/core/interfaces/serializer';

/**
 * REQUIRED
 * Provider configuration for HTTP streaming tools.
 *
 * Uses HTTP Chunked Transfer Encoding to enable streaming of large responses
 * or real-time data. Useful for tools that return large datasets or provide
 * progressive results. All tool arguments not mapped to URL body, headers
 * or query pattern parameters are passed as query parameters using '?arg_name={arg_value}'.
 *
 * Attributes:
 *     call_template_type: Always "streamable_http" for HTTP streaming providers.
 *     url: The streaming HTTP endpoint URL. Supports path parameters.
 *     http_method: The HTTP method to use (GET or POST).
 *     content_type: The Content-Type header for requests.
 *     chunk_size: Size of each chunk in bytes for reading the stream.
 *     timeout: Request timeout in milliseconds.
 *     headers: Optional static headers to include in requests.
 *     auth: Optional authentication configuration.
 *     body_field: Optional tool argument name to map to HTTP request body.
 *     header_fields: List of tool argument names to map to HTTP request headers.
 */
export interface StreamableHttpCallTemplate extends CallTemplate {
  call_template_type: 'streamable_http';
  url: string;
  http_method: 'GET' | 'POST';
  content_type: string;
  chunk_size: number;
  timeout: number;
  headers?: Record<string, string>;
  body_field?: string | null;
  header_fields?: string[] | null;
}

/**
 * Streamable HTTP Call Template schema.
 */
export const StreamableHttpCallTemplateSchema: z.ZodType<StreamableHttpCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('streamable_http'),
  url: z.string().describe('The streaming HTTP endpoint URL. Supports path parameters.'),
  http_method: z.enum(['GET', 'POST']).default('GET'),
  content_type: z.string().default('application/octet-stream').describe('The Content-Type header for requests.'),
  chunk_size: z.number().default(4096).describe('Size of each chunk in bytes for reading the stream.'),
  timeout: z.number().default(60000).describe('Request timeout in milliseconds.'),
  auth: AuthSchema.optional().describe('Optional authentication configuration.'),
  headers: z.record(z.string(), z.string()).optional().describe('Optional static headers to include in requests.'),
  body_field: z.string().nullable().optional().describe('The name of the single input field to be sent as the request body.'),
  header_fields: z.array(z.string()).nullable().optional().describe('List of input fields to be sent as request headers.'),
}) as z.ZodType<StreamableHttpCallTemplate>;

/**
 * REQUIRED
 * Serializer for StreamableHttpCallTemplate.
 */
export class StreamableHttpCallTemplateSerializer extends Serializer<StreamableHttpCallTemplate> {
  /**
   * REQUIRED
   * Convert StreamableHttpCallTemplate to dictionary.
   */
  toDict(obj: StreamableHttpCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      url: obj.url,
      http_method: obj.http_method,
      content_type: obj.content_type,
      chunk_size: obj.chunk_size,
      timeout: obj.timeout,
      auth: obj.auth,
      headers: obj.headers,
      body_field: obj.body_field,
      header_fields: obj.header_fields,
    };
  }

  /**
   * REQUIRED
   * Validate dictionary and convert to StreamableHttpCallTemplate.
   */
  validateDict(obj: Record<string, unknown>): StreamableHttpCallTemplate {
    try {
      return StreamableHttpCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid StreamableHttpCallTemplate: ${e.message}\n${e.stack || ''}`);
    }
  }
}
