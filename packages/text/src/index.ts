/**
 * Text Communication Protocol plugin for UTCP.
 */
// packages/text/src/index.ts
import { CommunicationProtocol, CallTemplateSerializer, ensureCorePluginsInitialized } from '@utcp/sdk';
import { TextCallTemplateSerializer } from './text_call_template';
import { TextCommunicationProtocol } from './text_communication_protocol';

/**
 * Registers the Text protocol's CallTemplate serializer
 * and its CommunicationProtocol implementation.
 * This function is called automatically when the package is imported.
 */
export function register(override: boolean = false): void {
  // Ensure core plugins are initialized first
  ensureCorePluginsInitialized();
  CallTemplateSerializer.registerCallTemplate('text', new TextCallTemplateSerializer(), override);
  CommunicationProtocol.communicationProtocols['text'] = new TextCommunicationProtocol();
}

// Automatically register Text plugin on import
register();

export * from './text_call_template';
export * from './text_communication_protocol';