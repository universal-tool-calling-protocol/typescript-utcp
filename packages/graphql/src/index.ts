import { CommunicationProtocol, CallTemplateSerializer, ensureCorePluginsInitialized } from '@utcp/sdk';
import { GraphQLCallTemplateSerializer } from './graphql_call_template';
import { GraphQLCommunicationProtocol } from './graphql_communication_protocol';

export function register(override: boolean = false): void {
  ensureCorePluginsInitialized();
  CallTemplateSerializer.registerCallTemplate('graphql', new GraphQLCallTemplateSerializer(), override);
  CommunicationProtocol.communicationProtocols['graphql'] = new GraphQLCommunicationProtocol();
}

register();

export * from './graphql_call_template';
export * from './graphql_communication_protocol';
