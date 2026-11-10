import { z } from 'zod';
import { AuthSchema, CallTemplate, Serializer } from '@utcp/sdk';

export interface GraphQLCallTemplate extends CallTemplate {
  call_template_type: 'graphql';
  url: string;
  operation_type: 'query' | 'mutation' | 'subscription';
  operation_name?: string;
  headers?: Record<string, string>;
  header_fields?: string[];
  query?: string;
  variable_types?: Record<string, string>;
}

export const GraphQLCallTemplateSchema: z.ZodType<GraphQLCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('graphql'),
  url: z.string().describe('The GraphQL endpoint URL.'),
  operation_type: z.enum(['query', 'mutation', 'subscription']).default('query'),
  operation_name: z.string().optional(),
  auth: AuthSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  header_fields: z.array(z.string()).optional().describe('Tool arguments sent as request headers instead of variables.'),
  query: z.string().optional().describe('Custom GraphQL document. Takes precedence over auto-generation.'),
  variable_types: z.record(z.string(), z.string()).optional().describe('GraphQL types for auto-generated variables. Defaults to String.'),
  allowed_communication_protocols: z.array(z.string()).optional(),
}) as z.ZodType<GraphQLCallTemplate>;

export class GraphQLCallTemplateSerializer extends Serializer<GraphQLCallTemplate> {
  toDict(obj: GraphQLCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      url: obj.url,
      operation_type: obj.operation_type,
      operation_name: obj.operation_name,
      auth: obj.auth,
      headers: obj.headers,
      header_fields: obj.header_fields,
      query: obj.query,
      variable_types: obj.variable_types,
      allowed_communication_protocols: obj.allowed_communication_protocols,
    };
  }

  validateDict(obj: Record<string, unknown>): GraphQLCallTemplate {
    try {
      return GraphQLCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid GraphQLCallTemplate: ${e.message}`);
    }
  }
}
