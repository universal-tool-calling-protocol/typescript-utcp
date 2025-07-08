/**
 * Universal Tool Calling Protocol (UTCP) TypeScript Library
 * 
 * A modern, flexible, and scalable standard for defining and interacting with tools
 * across a wide variety of communication protocols.
 */

// Export main client
export { UtcpClient } from './client/utcp-client';
export type { UtcpClientInterface } from './client/utcp-client';

// Export configuration
export { UtcpClientConfig, UtcpClientConfigSchema, UtcpVariableNotFound } from './client/utcp-client-config';

// Export shared models
export {
  Tool,
  ToolInputOutputSchema,
  ToolContext,
  createUtcpTool,
  ToolSchema,
  ToolInputOutputSchemaSchema,
} from './shared/tool';

export {
  Provider,
  HttpProvider,
  SSEProvider,
  StreamableHttpProvider,
  CliProvider,
  WebSocketProvider,
  GRPCProvider,
  GraphQLProvider,
  TCPProvider,
  UDPProvider,
  WebRTCProvider,
  MCPProvider,
  TextProvider,
  ProviderUnion,
  ProviderType,
  ProviderSchema,
  ProviderUnionSchema,
  ProviderTypeSchema,
} from './shared/provider';

export {
  Auth,
  ApiKeyAuth,
  BasicAuth,
  OAuth2Auth,
  AuthUnion,
  AuthSchema,
  AuthUnionSchema,
} from './shared/auth';

export {
  UtcpManual,
  UtcpManualSchema,
} from './shared/utcp-manual';

// Export transport interfaces
export { ClientTransportInterface } from './client/transport-interfaces/client-transport-interface';
export { HttpClientTransport } from './client/transport-interfaces/http-transport';
export { WebSocketClientTransport } from './client/transport-interfaces/websocket-transport';
export { CliClientTransport } from './client/transport-interfaces/cli-transport';

// Export repository and search interfaces
export { ToolRepository } from './client/tool-repository';
export { InMemoryToolRepository } from './client/tool-repositories/in-memory-tool-repository';
export { ToolSearchStrategy } from './client/tool-search-strategy';
export { TagSearchStrategy } from './client/tool-search-strategies/tag-search';

// Export version info
export * from './version';
