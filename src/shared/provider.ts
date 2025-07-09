import { z } from 'zod';
import { 
  Auth, 
  AuthSchema,
  ApiKeyAuthSchema,
  BasicAuthSchema,
  OAuth2Auth, 
  OAuth2AuthSchema 
} from './auth';

/**
 * Provider types supported by UTCP
 */
export const ProviderTypeSchema = z.enum([
  'http',        // RESTful HTTP/HTTPS API
  'sse',         // Server-Sent Events
  'http_stream', // HTTP Chunked Transfer Encoding
  'cli',         // Command Line Interface
  'websocket',   // WebSocket bidirectional connection
  'grpc',        // gRPC (Google Remote Procedure Call)
  'graphql',     // GraphQL query language
  'tcp',         // Raw TCP socket
  'udp',         // User Datagram Protocol
  'webrtc',      // Web Real-Time Communication
  'mcp',         // Model Context Protocol
  'text',        // Text file provider
]);

export type ProviderType = z.infer<typeof ProviderTypeSchema>;

/**
 * Base Provider schema
 */
export const ProviderSchema = z.object({
  name: z.string(),
  provider_type: ProviderTypeSchema,
  startup_command: z.array(z.string()).optional(), // For launching the provider if needed
});

export type Provider = z.infer<typeof ProviderSchema>;

/**
 * HTTP Provider schema for RESTful HTTP/HTTPS API tools
 */
export const HttpProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('http'),
  http_method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  url: z.string(),
  content_type: z.string().default('application/json'),
  auth: AuthSchema.optional(),
  headers: z.record(z.string()).optional(),
  body_field: z.string().optional().default('body').describe('The name of the single input field to be sent as the request body.'),
  header_fields: z.array(z.string()).optional().describe('List of input fields to be sent as request headers.'),
});

export type HttpProvider = z.infer<typeof HttpProviderSchema>;

/**
 * SSE Provider schema for Server-Sent Events tools
 */
export const SSEProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('sse'),
  url: z.string(),
  event_type: z.string().optional(),
  reconnect: z.boolean().default(true),
  retry_timeout: z.number().default(30000), // Retry timeout in milliseconds if disconnected
  auth: AuthSchema.optional(),
  headers: z.record(z.string()).optional(),
  body_field: z.string().optional().describe('The name of the single input field to be sent as the request body.'),
  header_fields: z.array(z.string()).optional().describe('List of input fields to be sent as request headers for the initial connection.'),
});

export type SSEProvider = z.infer<typeof SSEProviderSchema>;

/**
 * HTTP Streaming Provider schema for HTTP Chunked Transfer Encoding tools
 */
export const StreamableHttpProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('http_stream'),
  url: z.string(),
  http_method: z.enum(['GET', 'POST']).default('GET'),
  content_type: z.string().default('application/octet-stream'),
  chunk_size: z.number().default(4096), // Size of chunks in bytes
  timeout: z.number().default(60000), // Timeout in milliseconds
  headers: z.record(z.string()).optional(),
  auth: AuthSchema.optional(),
  body_field: z.string().optional().describe('The name of the single input field to be sent as the request body.'),
  header_fields: z.array(z.string()).optional().describe('List of input fields to be sent as request headers.'),
});

export type StreamableHttpProvider = z.infer<typeof StreamableHttpProviderSchema>;

/**
 * CLI Provider schema for Command Line Interface tools
 */
export const CliProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('cli'),
  command_name: z.string(),
  env_vars: z.record(z.string()).optional().describe('Environment variables to set when executing the command'),
  working_dir: z.string().optional().describe('Working directory for command execution'),
  auth: z.null(),
});

export type CliProvider = z.infer<typeof CliProviderSchema>;

/**
 * WebSocket Provider schema for WebSocket tools
 */
export const WebSocketProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('websocket'),
  url: z.string(),
  protocol: z.string().optional(),
  keep_alive: z.boolean().default(true),
  auth: AuthSchema.optional(),
  headers: z.record(z.string()).optional(),
  header_fields: z.array(z.string()).optional().describe('List of input fields to be sent as request headers for the initial connection.'),
});

export type WebSocketProvider = z.infer<typeof WebSocketProviderSchema>;

/**
 * gRPC Provider schema for gRPC tools
 */
export const GRPCProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('grpc'),
  host: z.string(),
  port: z.number(),
  service_name: z.string(),
  method_name: z.string(),
  use_ssl: z.boolean().default(false),
  auth: AuthSchema.optional(),
});

export type GRPCProvider = z.infer<typeof GRPCProviderSchema>;

/**
 * GraphQL Provider schema for GraphQL tools
 */
export const GraphQLProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('graphql'),
  url: z.string(),
  operation_type: z.enum(['query', 'mutation', 'subscription']).default('query'),
  operation_name: z.string().optional(),
  auth: AuthSchema.optional(),
  headers: z.record(z.string()).optional(),
  header_fields: z.array(z.string()).optional().describe('List of input fields to be sent as request headers for the initial connection.'),
});

export type GraphQLProvider = z.infer<typeof GraphQLProviderSchema>;

/**
 * TCP Provider schema for raw TCP socket tools
 */
export const TCPProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('tcp'),
  host: z.string(),
  port: z.number(),
  timeout: z.number().default(30000),
  auth: z.null(),
});

export type TCPProvider = z.infer<typeof TCPProviderSchema>;

/**
 * UDP Provider schema for UDP socket tools
 */
export const UDPProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('udp'),
  host: z.string(),
  port: z.number(),
  timeout: z.number().default(30000),
  auth: z.null(),
});

export type UDPProvider = z.infer<typeof UDPProviderSchema>;

/**
 * WebRTC Provider schema for Web Real-Time Communication tools
 */
export const WebRTCProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('webrtc'),
  signaling_server: z.string(),
  peer_id: z.string(),
  data_channel_name: z.string().default('tools'),
  auth: z.null(),
});

export type WebRTCProvider = z.infer<typeof WebRTCProviderSchema>;

/**
 * MCP Stdio Server schema for MCP servers connected via stdio
 */
export const McpStdioServerSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string()).optional().default({}),
});

export type McpStdioServer = z.infer<typeof McpStdioServerSchema>;



/**
 * MCP HTTP Server schema for MCP servers connected via streamable HTTP
 */
export const McpHttpServerSchema = z.object({
  transport: z.literal('http'),
  url: z.string(),
});

export type McpHttpServer = z.infer<typeof McpHttpServerSchema>;

/**
 * Combined MCP Server types
 */
export const McpServerSchema = z.discriminatedUnion('transport', [
  McpStdioServerSchema,
  McpHttpServerSchema,
]);

export type McpServer = z.infer<typeof McpServerSchema>;

/**
 * MCP Configuration schema
 */
export const McpConfigSchema = z.object({
  mcpServers: z.record(McpServerSchema),
});

export type McpConfig = z.infer<typeof McpConfigSchema>;

/**
 * MCP Provider schema for Model Context Protocol tools
 */
export const MCPProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('mcp'),
  config: McpConfigSchema,
  auth: OAuth2AuthSchema.optional(),
});

export type MCPProvider = z.infer<typeof MCPProviderSchema>;

/**
 * Text Provider schema for text file-based tools
 */
export const TextProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('text'),
  file_path: z.string().describe('The path to the file containing the tool definitions.'),
  auth: z.null().optional().default(null),
});

export type TextProvider = z.infer<typeof TextProviderSchema>;

/**
 * Combined Provider schema using discriminated union based on provider_type
 */
export const ProviderUnionSchema = z.discriminatedUnion('provider_type', [
  HttpProviderSchema,
  SSEProviderSchema,
  StreamableHttpProviderSchema,
  CliProviderSchema,
  WebSocketProviderSchema,
  GRPCProviderSchema,
  GraphQLProviderSchema,
  TCPProviderSchema,
  UDPProviderSchema,
  WebRTCProviderSchema,
  MCPProviderSchema,
  TextProviderSchema,
]);

export type ProviderUnion = z.infer<typeof ProviderUnionSchema>;
