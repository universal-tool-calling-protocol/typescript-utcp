// packages/http/src/sse_call_template.ts
import { z } from 'zod';
import { Auth, AuthSchema } from '@utcp/sdk';
import { CallTemplate } from '@utcp/sdk';
import { Serializer } from '@utcp/sdk';

/**
 * REQUIRED
 * Provider configuration for Server-Sent Events (SSE) tools.
 *
 * Enables real-time streaming of events from server to client using the
 * Server-Sent Events protocol. Supports automatic reconnection and
 * event type filtering. All tool arguments not mapped to URL body, headers
 * or query pattern parameters are passed as query parameters using '?arg_name={arg_value}'.
 *
 * Attributes:
 *     call_template_type: Always "sse" for SSE providers.
 *     url: The SSE endpoint URL to connect to.
 *     event_type: Optional filter for specific event types. If None, all events are received.
 *     reconnect: Whether to automatically reconnect on connection loss.
 *     retry_timeout: Timeout in milliseconds before attempting reconnection.
 *     auth: Optional authentication configuration.
 *     headers: Optional static headers for the initial connection.
 *     body_field: Optional tool argument name to map to request body during connection.
 *     header_fields: List of tool argument names to map to HTTP headers during connection.
 */
export interface SseCallTemplate extends CallTemplate {
  call_template_type: 'sse';
  url: string;
  event_type?: string | null;
  reconnect: boolean;
  retry_timeout: number;
  headers?: Record<string, string>;
  body_field?: string | null;
  header_fields?: string[] | null;
}

/**
 * SSE Call Template schema.
 */
export const SseCallTemplateSchema: z.ZodType<SseCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('sse'),
  url: z.string().describe('The SSE endpoint URL to connect to.'),
  event_type: z.string().nullable().optional().describe('Optional filter for specific event types. If null, all events are received.'),
  reconnect: z.boolean().default(true).describe('Whether to automatically reconnect on connection loss.'),
  retry_timeout: z.number().default(30000).describe('Timeout in milliseconds before attempting reconnection.'),
  auth: AuthSchema.optional().describe('Optional authentication configuration.'),
  headers: z.record(z.string(), z.string()).optional().describe('Optional static headers for the initial connection.'),
  body_field: z.string().nullable().optional().describe('The name of the single input field to be sent as the request body.'),
  header_fields: z.array(z.string()).nullable().optional().describe('List of input fields to be sent as request headers for the initial connection.'),
}) as z.ZodType<SseCallTemplate>;

/**
 * REQUIRED
 * Serializer for SseCallTemplate.
 */
export class SseCallTemplateSerializer extends Serializer<SseCallTemplate> {
  /**
   * REQUIRED
   * Convert SseCallTemplate to dictionary.
   */
  toDict(obj: SseCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      url: obj.url,
      event_type: obj.event_type,
      reconnect: obj.reconnect,
      retry_timeout: obj.retry_timeout,
      auth: obj.auth,
      headers: obj.headers,
      body_field: obj.body_field,
      header_fields: obj.header_fields,
    };
  }

  /**
   * REQUIRED
   * Validate dictionary and convert to SseCallTemplate.
   */
  validateDict(obj: Record<string, unknown>): SseCallTemplate {
    try {
      return SseCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid SseCallTemplate: ${e.message}\n${e.stack || ''}`);
    }
  }
}
