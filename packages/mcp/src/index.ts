/**
 * MCP Communication Protocol plugin for UTCP.
 */
// packages/mcp/src/index.ts
import { CommunicationProtocol, CallTemplateSerializer } from '@utcp/sdk';
import { McpCallTemplateSerializer } from './mcp_call_template';
import { McpCommunicationProtocol } from './mcp_communication_protocol';

/**
 * Registers the MCP protocol's CallTemplate serializer
 * and its CommunicationProtocol implementation.
 * This function is called automatically when the package is imported.
 */
export function register(override: boolean = false): void {
  CallTemplateSerializer.registerCallTemplate('mcp', new McpCallTemplateSerializer(), override);
  // A FACTORY, not an instance: this protocol holds live MCP sessions (and,
  // for stdio, child processes). Shared, every client in the process would
  // dial into one cache — so a caller that creates a client per tenant, per
  // user, or per pooled connection would not actually be isolating them, and
  // one client's `close()` would drain everyone's sessions. One instance per
  // client gives each its own connections and its own teardown.
  CommunicationProtocol.communicationProtocolFactories['mcp'] = () => new McpCommunicationProtocol();
}

// Automatically register MCP plugin on import
register();

export * from './mcp_call_template';
export * from './mcp_communication_protocol';