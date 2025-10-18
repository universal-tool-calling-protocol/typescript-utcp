/**
 * Text Communication Protocol plugin for UTCP.
 */
// packages/text/src/index.ts
import { CommunicationProtocol } from '@utcp/core/interfaces/communication_protocol';
import { CallTemplateSerializer } from '@utcp/core/data/call_template';
import { ensureCorePluginsInitialized } from '@utcp/core/plugins/plugin_loader';
import { TextCallTemplateSerializer } from '@utcp/text/text_call_template';
import { TextCommunicationProtocol } from '@utcp/text/text_communication_protocol';

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