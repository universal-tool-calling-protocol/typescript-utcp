/**
 * File Communication Protocol plugin for UTCP.
 */
// packages/file/src/index.ts
import { CommunicationProtocol, CallTemplateSerializer, ensureCorePluginsInitialized } from '@utcp/sdk';
import { FileCallTemplateSerializer } from './file_call_template';
import { FileCommunicationProtocol } from './file_communication_protocol';

/**
 * Registers the File protocol's CallTemplate serializer
 * and its CommunicationProtocol implementation.
 * This function is called automatically when the package is imported.
 */
export function register(override: boolean = false): void {
  // Ensure core plugins are initialized first
  ensureCorePluginsInitialized();
  
  // Register the CallTemplate serializer
  CallTemplateSerializer.registerCallTemplate('file', new FileCallTemplateSerializer(), override);
  
  // Register the CommunicationProtocol instance
  CommunicationProtocol.communicationProtocols['file'] = new FileCommunicationProtocol();
}

// Automatically register File plugin on import
register();

// Export all public APIs
export * from './file_call_template';
export * from './file_communication_protocol';