/**
 * Direct Call Communication Protocol plugin for UTCP.
 */
// packages/direct-call/src/index.ts
import { CommunicationProtocol, CallTemplateSerializer, ensureCorePluginsInitialized } from '@utcp/sdk';
import { DirectCallTemplateSerializer } from './direct_call_template';
import { DirectCommunicationProtocol } from './direct_communication_protocol';
import { registerPendingCallables } from './decorator';

/**
 * Registers the Direct Call protocol's CallTemplate serializer
 * and its CommunicationProtocol implementation.
 * This function is called automatically when the package is imported.
 */
export function register(override: boolean = false): void {
  // Ensure core plugins are initialized first
  ensureCorePluginsInitialized();
  
  // Register the CallTemplate serializer
  CallTemplateSerializer.registerCallTemplate('direct-call', new DirectCallTemplateSerializer(), override);
  
  // Register the CommunicationProtocol instance
  CommunicationProtocol.communicationProtocols['direct-call'] = new DirectCommunicationProtocol();
  
  // Register any pending callables that were decorated before the protocol was initialized
  registerPendingCallables();
}

// Automatically register Direct Call plugin on import
register();

// Export all public APIs
export * from './direct_call_template';
export * from './direct_communication_protocol';
export * from './decorator';
