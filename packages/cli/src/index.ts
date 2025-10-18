// packages/cli/src/index.ts
import { CommunicationProtocol } from '@utcp/core/interfaces/communication_protocol';
import { CallTemplateSerializer } from '@utcp/core/data/call_template';
import { CliCallTemplateSerializer } from '@utcp/cli/cli_call_template';
import { CliCommunicationProtocol } from '@utcp/cli/cli_communication_protocol';

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