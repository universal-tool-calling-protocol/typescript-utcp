// packages/mcp/src/mcp_call_template.ts
import { z } from 'zod';
import { CallTemplate } from '@utcp/sdk';
import { OAuth2Auth } from '@utcp/sdk';
import { AuthSchema } from '@utcp/sdk';
import { Serializer } from '@utcp/sdk';

/**
 * Type alias for MCP server configurations.
 *
 * Union type for all supported MCP server transport configurations,
 * including both stdio and HTTP-based servers.
 */

/**
 * Interface for MCP Stdio Server parameters.
 * Used for local process communication with an MCP server.
 */
export interface McpStdioServer {
  transport: 'stdio';
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
}

/**
 * Schema for MCP Stdio Server parameters.
 */
export const McpStdioServerSchema: z.ZodType<McpStdioServer> = z.object({
  transport: z.literal('stdio'),
  command: z.string().describe('The command to execute the MCP server.'),
  args: z.array(z.string()).optional().default([]).describe('Arguments to pass to the command.'),
  cwd: z.string().optional().describe('Working directory for the command.'),
  env: z.record(z.string(), z.string()).optional().default({}).describe('Environment variables for the command.'),
}) as z.ZodType<McpStdioServer>;


/**
 * Interface for MCP HTTP Server parameters.
 * Used for remote HTTP communication with an MCP server.
 */
export interface McpHttpServer {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
  timeout: number;
  sse_read_timeout: number;
  terminate_on_close: boolean;
}

/**
 * MCP HTTP Server schema for MCP servers connected via streamable HTTP.
 */
export const McpHttpServerSchema: z.ZodType<McpHttpServer> = z.object({
  transport: z.literal('http'),
  url: z.string().describe('The URL of the MCP HTTP server endpoint.'),
  headers: z.record(z.string(), z.string()).optional().describe('Optional HTTP headers for the connection.'),
  timeout: z.number().optional().default(30).describe('Timeout for HTTP requests in seconds.'),
  sse_read_timeout: z.number().optional().default(300).describe('Read timeout for SSE connections in seconds (e.g., for `streamable-http` MCP servers).'),
  terminate_on_close: z.boolean().optional().default(true).describe('Whether to terminate the HTTP connection on client close.'),
}) as z.ZodType<McpHttpServer>;


/**
 * Type alias for a discriminated union of all supported MCP server transport configurations.
 */
export type McpServerConfig = McpStdioServer | McpHttpServer;

/**
 * A discriminated union of all supported MCP server transport configurations.
 */
export const McpServerConfigSchema = z.discriminatedUnion('transport', [
  McpStdioServerSchema as z.ZodObject<any, any, any, McpStdioServer, any>,
  McpHttpServerSchema as z.ZodObject<any, any, any, McpHttpServer, any>,  
]);

/**
 * REQUIRED
 * Implementing this class is not required!!!
 * The McpCallTemplate just needs to support a MCP compliant server configuration.
 *
 * Configuration container for multiple MCP servers.
 *
 * Holds a collection of named MCP server configurations, allowing
 * a single MCP provider to manage multiple server connections.
 *
 * Attributes:
 *     mcpServers: Dictionary mapping server names to their configurations.
 */
export interface McpConfig {
  mcpServers: Record<string, any>;
}

/**
 * Configuration for multiple MCP servers under one provider.
 * Accepts any structure to match MCP official configuration format.
 */
export const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.any()).describe('Dictionary mapping server names to their configurations.'),
});

/**
 * REQUIRED
 * Provider configuration for Model Context Protocol (MCP) tools.
 *
 * Enables communication with MCP servers that provide structured tool
 * interfaces. Supports both stdio (local process) and HTTP (remote)
 * transport methods.
 *
 * Attributes:
 *     call_template_type: Always "mcp" for MCP providers.
 *     config: Configuration object containing MCP server definitions.
 *         This follows the same format as the official MCP server configuration.
 *     auth: Optional OAuth2 authentication for HTTP-based MCP servers.
 *     register_resources_as_tools: Whether to register MCP resources as callable tools.
 *         When True, server resources are exposed as tools that can be called.
 *         Default is False.
 */
export interface McpCallTemplate extends CallTemplate {
  name?: string;
  call_template_type: 'mcp';
  config: McpConfig;
  auth?: OAuth2Auth;
  register_resources_as_tools?: boolean;
}

/**
 * MCP Call Template schema for Model Context Protocol tools.
 * Enables communication with MCP servers.
 */
export const McpCallTemplateSchema: z.ZodType<McpCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('mcp'),
  config: McpConfigSchema.describe('Configuration object containing MCP server definitions. Follows the same format as the official MCP server configuration.'),
  auth: AuthSchema.nullable().optional().describe('Optional OAuth2 authentication for HTTP-based MCP servers.'),
  register_resources_as_tools: z.boolean().default(false).describe('Whether to register MCP resources as callable tools. When True, server resources are exposed as tools that can be called.'),
}) as z.ZodType<McpCallTemplate>;

/**
 * REQUIRED
 * Serializer for McpCallTemplate.
 */
export class McpCallTemplateSerializer extends Serializer<McpCallTemplate> {
  /**
   * REQUIRED
   * Convert McpCallTemplate to dictionary.
   */
  toDict(obj: McpCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      config: obj.config,
      auth: obj.auth,
      register_resources_as_tools: obj.register_resources_as_tools,
    };
  }

  /**
   * REQUIRED
   * Validate and convert dictionary to McpCallTemplate.
   */
  validateDict(obj: Record<string, unknown>): McpCallTemplate {
    try {
      return McpCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid McpCallTemplate: ${e.message}\n${e.stack || ''}`);
    }
  }
}