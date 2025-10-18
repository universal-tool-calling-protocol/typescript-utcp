/**
 * HTTP Communication Protocol plugin for UTCP.
 * Includes HTTP, Streamable HTTP, and SSE (Server-Sent Events) protocols.
 */
// packages/http/src/index.ts
import { CommunicationProtocol } from '@utcp/core/interfaces/communication_protocol';
import { CallTemplateSerializer } from '@utcp/core/data/call_template';
import { ensureCorePluginsInitialized } from '@utcp/core/plugins/plugin_loader';
import { HttpCallTemplateSerializer } from '@utcp/http/http_call_template';
import { StreamableHttpCallTemplateSerializer } from '@utcp/http/streamable_http_call_template';
import { SseCallTemplateSerializer } from '@utcp/http/sse_call_template';
import { HttpCommunicationProtocol } from '@utcp/http/http_communication_protocol';
import { StreamableHttpCommunicationProtocol } from '@utcp/http/streamable_http_communication_protocol';
import { SseCommunicationProtocol } from '@utcp/http/sse_communication_protocol';

/**
 * Registers all HTTP-based protocol CallTemplate serializers
 * and their CommunicationProtocol implementations.
 * This function is called automatically when the package is imported.
 */
export function register(override: boolean = false): void {
  // Ensure core plugins (including auth serializers) are initialized first
  ensureCorePluginsInitialized();
  // Register HTTP
  CallTemplateSerializer.registerCallTemplate('http', new HttpCallTemplateSerializer(), override);
  CommunicationProtocol.communicationProtocols['http'] = new HttpCommunicationProtocol();
  
  // Register Streamable HTTP
  CallTemplateSerializer.registerCallTemplate('streamable_http', new StreamableHttpCallTemplateSerializer(), override);
  CommunicationProtocol.communicationProtocols['streamable_http'] = new StreamableHttpCommunicationProtocol();
  
  // Register SSE (Server-Sent Events)
  CallTemplateSerializer.registerCallTemplate('sse', new SseCallTemplateSerializer(), override);
  CommunicationProtocol.communicationProtocols['sse'] = new SseCommunicationProtocol();
}

// Automatically register HTTP plugins on import
register();

export * from './http_call_template';
export * from './http_communication_protocol';
export * from './streamable_http_call_template';
export * from './streamable_http_communication_protocol';
export * from './sse_call_template';
export * from './sse_communication_protocol';
export * from './openapi_converter';