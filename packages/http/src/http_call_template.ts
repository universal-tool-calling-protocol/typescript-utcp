// packages/http/src/http_call_template.ts
import { z } from 'zod';
import { Auth, AuthSchema, AuthSerializer } from '@utcp/core/data/auth';
import { CallTemplate } from '@utcp/core/data/call_template';
import { Serializer } from '@utcp/core/interfaces/serializer';

/**
 * REQUIRED
 * Provider configuration for HTTP-based tools.
 *
 * Supports RESTful HTTP/HTTPS APIs with various HTTP methods, authentication,
 * custom headers, and flexible request/response handling. Supports URL path
 * parameters using {parameter_name} syntax.
 */

export interface HttpCallTemplate extends CallTemplate {
  call_template_type: 'http';
  http_method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  content_type: string;
  headers?: Record<string, string>;
  body_field?: string;
  header_fields?: string[];
  auth_tools?: Auth | null;
}

/**
 * HTTP Call Template schema for RESTful HTTP/HTTPS API tools.
 * Extends the base CallTemplate and defines HTTP-specific configuration.
 */
export const HttpCallTemplateSchema: z.ZodType<HttpCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('http'),
  http_method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  url: z.string().describe('The base URL for the HTTP endpoint. Supports path parameters like "https://api.example.com/users/{user_id}".'),
  content_type: z.string().default('application/json').describe('The Content-Type header for requests.'),
  auth: AuthSchema.optional().describe('Optional authentication configuration.'),
  headers: z.record(z.string(), z.string()).optional().describe('Optional static headers to include in all requests.'),
  body_field: z.string().optional().default('body').describe('The name of the single input field to be sent as the request body.'),
  header_fields: z.array(z.string()).optional().describe('List of input fields to be sent as request headers.'),
  auth_tools: AuthSchema.nullable().optional().transform((val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && 'auth_type' in val) {
      return new AuthSerializer().validateDict(val as any);
    }
    return val as Auth;
  }).describe('Authentication configuration for generated tools'),
}) as z.ZodType<HttpCallTemplate>;

/**
 * REQUIRED
 * Serializer for HttpCallTemplate.
 */
export class HttpCallTemplateSerializer extends Serializer<HttpCallTemplate> {
  toDict(obj: HttpCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      http_method: obj.http_method,
      url: obj.url,
      content_type: obj.content_type,
      auth: obj.auth,
      auth_tools: obj.auth_tools ? new AuthSerializer().toDict(obj.auth_tools) : null,
      headers: obj.headers,
      body_field: obj.body_field,
      header_fields: obj.header_fields,
    };
  }

  validateDict(obj: Record<string, unknown>): HttpCallTemplate {
    try {
      return HttpCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid HttpCallTemplate: ${e.message}\n${e.stack || ''}`);
    }
  }
}