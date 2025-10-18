/**
 * MCP Communication Protocol plugin for UTCP.
 */
// packages/mcp/src/index.ts
import { CommunicationProtocol } from '@utcp/core/interfaces/communication_protocol';
import { CallTemplateSerializer } from '@utcp/core/data/call_template';
import { McpCallTemplateSerializer } from '@utcp/mcp/mcp_call_template';
import { McpCommunicationProtocol } from '@utcp/mcp/mcp_communication_protocol';

/**
 * Registers the MCP protocol's CallTemplate serializer
 * and its CommunicationProtocol implementation.
 * This function is called automatically when the package is imported.
 */
export function register(override: boolean = false): void {
  CallTemplateSerializer.registerCallTemplate('mcp', new McpCallTemplateSerializer(), override);
  CommunicationProtocol.communicationProtocols['mcp'] = new McpCommunicationProtocol();
}

// Automatically register MCP plugin on import
register();

export * from './mcp_call_template';
export * from './mcp_communication_protocol';