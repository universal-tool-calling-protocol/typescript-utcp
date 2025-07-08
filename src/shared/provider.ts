import { z } from 'zod';
import { AuthUnionSchema } from './auth';

// Provider types
export const ProviderTypeSchema = z.enum([
  'http',
  'sse',
  'http_stream',
  'cli',
  'websocket',
  'grpc',
  'graphql',
  'tcp',
  'udp',
  'webrtc',
  'mcp',
  'text',
]);

// Base provider schema
export const ProviderSchema = z.object({
  name: z.string(),
  provider_type: ProviderTypeSchema,
  startup_command: z.array(z.string()).optional(),
});

// HTTP Provider
export const HttpProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('http'),
  http_method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  url: z.string(),
  content_type: z.string().default('application/json'),
  auth: AuthUnionSchema.optional(),
  headers: z.record(z.string()).optional(),
  body_field: z.string().default('body'),
  header_fields: z.array(z.string()).optional(),
});

// SSE Provider
export const SSEProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('sse'),
  url: z.string(),
  event_type: z.string().optional(),
  reconnect: z.boolean().default(true),
  reconnect_interval: z.number().default(1000),
  auth: AuthUnionSchema.optional(),
  headers: z.record(z.string()).optional(),
});

// Streamable HTTP Provider
export const StreamableHttpProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('http_stream'),
  url: z.string(),
  http_method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('POST'),
  content_type: z.string().default('application/json'),
  auth: AuthUnionSchema.optional(),
  headers: z.record(z.string()).optional(),
  body_field: z.string().default('body'),
  header_fields: z.array(z.string()).optional(),
});

// CLI Provider
export const CliProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('cli'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  timeout: z.number().optional(),
});

// WebSocket Provider
export const WebSocketProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('websocket'),
  url: z.string(),
  subprotocols: z.array(z.string()).optional(),
  auth: AuthUnionSchema.optional(),
  headers: z.record(z.string()).optional(),
  ping_interval: z.number().optional(),
  pong_timeout: z.number().optional(),
});

// gRPC Provider
export const GRPCProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('grpc'),
  host: z.string(),
  port: z.number(),
  service: z.string(),
  method: z.string(),
  proto_file: z.string().optional(),
  package_name: z.string().optional(),
  credentials: z.enum(['insecure', 'ssl']).default('insecure'),
  auth: AuthUnionSchema.optional(),
});

// GraphQL Provider
export const GraphQLProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('graphql'),
  endpoint: z.string(),
  query: z.string().optional(),
  mutation: z.string().optional(),
  subscription: z.string().optional(),
  auth: AuthUnionSchema.optional(),
  headers: z.record(z.string()).optional(),
});

// TCP Provider
export const TCPProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('tcp'),
  host: z.string(),
  port: z.number(),
  encoding: z.string().default('utf8'),
  delimiter: z.string().optional(),
  timeout: z.number().optional(),
});

// UDP Provider
export const UDPProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('udp'),
  host: z.string(),
  port: z.number(),
  encoding: z.string().default('utf8'),
  timeout: z.number().optional(),
});

// WebRTC Provider
export const WebRTCProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('webrtc'),
  signaling_url: z.string(),
  ice_servers: z.array(z.object({
    urls: z.array(z.string()),
    username: z.string().optional(),
    credential: z.string().optional(),
  })).optional(),
  data_channel_label: z.string().default('utcp'),
});

// MCP Provider
export const MCPProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('mcp'),
  transport: z.enum(['stdio', 'sse']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
});

// Text Provider
export const TextProviderSchema = ProviderSchema.extend({
  provider_type: z.literal('text'),
  file_path: z.string(),
  encoding: z.string().default('utf8'),
  watch: z.boolean().default(false),
});

// Union type for all provider types
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

// TypeScript types
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type HttpProvider = z.infer<typeof HttpProviderSchema>;
export type SSEProvider = z.infer<typeof SSEProviderSchema>;
export type StreamableHttpProvider = z.infer<typeof StreamableHttpProviderSchema>;
export type CliProvider = z.infer<typeof CliProviderSchema>;
export type WebSocketProvider = z.infer<typeof WebSocketProviderSchema>;
export type GRPCProvider = z.infer<typeof GRPCProviderSchema>;
export type GraphQLProvider = z.infer<typeof GraphQLProviderSchema>;
export type TCPProvider = z.infer<typeof TCPProviderSchema>;
export type UDPProvider = z.infer<typeof UDPProviderSchema>;
export type WebRTCProvider = z.infer<typeof WebRTCProviderSchema>;
export type MCPProvider = z.infer<typeof MCPProviderSchema>;
export type TextProvider = z.infer<typeof TextProviderSchema>;
export type ProviderUnion = z.infer<typeof ProviderUnionSchema>;
