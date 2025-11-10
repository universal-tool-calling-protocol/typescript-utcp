/**
 * Code Mode plugin for UTCP.
 * Enables TypeScript code execution with direct access to registered tools.
 */

// Export all public APIs
export { CodeModeUtcpClient } from './code_mode_utcp_client';

// Type exports for better TypeScript support
export type {
  Tool,
  JsonSchema,
  UtcpClientConfig,
} from '@utcp/sdk';
