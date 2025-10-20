// packages/cli/src/index.ts
import { CommunicationProtocol, CallTemplateSerializer } from '@utcp/sdk';
import { CliCallTemplateSerializer } from './cli_call_template';
import { CliCommunicationProtocol } from './cli_communication_protocol';

/**
 * Registers the CLI protocol's CallTemplate serializer
 * and its CommunicationProtocol implementation.
 * This function should be called once when the CLI plugin is loaded.
 */
export function register(override: boolean = false): void {
  CallTemplateSerializer.registerCallTemplate('cli', new CliCallTemplateSerializer(), override);
  CommunicationProtocol.communicationProtocols['cli'] = new CliCommunicationProtocol();
}

export * from './cli_call_template';
export * from './cli_communication_protocol';