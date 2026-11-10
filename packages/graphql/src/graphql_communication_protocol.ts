import { buildClientSchema, getIntrospectionQuery, IntrospectionQuery } from 'graphql';
import {
  ApiKeyAuth,
  BasicAuth,
  CallTemplate,
  CommunicationProtocol,
  IUtcpClient,
  OAuth2Auth,
  RegisterManualResult,
  Tool,
  UtcpManualSerializer,
} from '@utcp/sdk';
import { GraphQLCallTemplate, GraphQLCallTemplateSchema } from './graphql_call_template';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function ensureSecureUrl(url: string, context: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Security error during ${context}: invalid URL ${JSON.stringify(url)}`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(host))) return;
  throw new Error(`Security error during ${context}: URL must use HTTPS or a loopback address. Got: ${JSON.stringify(url)}`);
}

export class GraphQLCommunicationProtocol implements CommunicationProtocol {
  private oauthTokens = new Map<string, { token: string; expiresAt: number }>();

  private async fetchOAuth2Token(auth: OAuth2Auth): Promise<string> {
    ensureSecureUrl(auth.token_url, 'OAuth2 token URL');
    const cacheKey = JSON.stringify([auth.token_url, auth.client_id, auth.client_secret, auth.scope ?? '']);
    const cached = this.oauthTokens.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const body: Record<string, string> = {
      grant_type: 'client_credentials',
      client_id: auth.client_id,
      client_secret: auth.client_secret,
    };
    if (auth.scope) body.scope = auth.scope;
    const response = await fetch(auth.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OAuth2 token request failed: HTTP ${response.status}`);
    }
    const { access_token: token, expires_in } = await response.json();
    if (!token) throw new Error('Access token not found in response.');
    const expiresIn = typeof expires_in === 'number' ? expires_in : 3600;
    this.oauthTokens.set(cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });
    return token;
  }

  private async prepareHeaders(template: GraphQLCallTemplate, toolArgs: Record<string, any> = {}): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...template.headers };
    const auth = template.auth;
    if (auth?.auth_type === 'api_key') {
      const apiKey = auth as ApiKeyAuth;
      if (apiKey.api_key && apiKey.location === 'header') headers[apiKey.var_name] = apiKey.api_key;
    } else if (auth?.auth_type === 'basic') {
      const basic = auth as BasicAuth;
      headers['Authorization'] = `Basic ${Buffer.from(`${basic.username}:${basic.password}`).toString('base64')}`;
    } else if (auth?.auth_type === 'oauth2') {
      headers['Authorization'] = `Bearer ${await this.fetchOAuth2Token(auth as OAuth2Auth)}`;
    }
    for (const field of template.header_fields ?? []) {
      if (field in toolArgs) headers[field] = String(toolArgs[field]);
    }
    return headers;
  }

  private async execute(url: string, headers: Record<string, string>, payload: Record<string, unknown>): Promise<any> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(payload),
      redirect: 'error',
    });
    const result = await response.json().catch(() => null);
    if (result?.errors?.length) {
      throw new Error(`GraphQL errors: ${result.errors.map((e: any) => e.message).join('; ')}`);
    }
    if (!response.ok) throw new Error(`GraphQL request failed: HTTP ${response.status}`);
    if (result === null) throw new Error('GraphQL response is not JSON.');
    return result.data;
  }

  async registerManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<RegisterManualResult> {
    const template = GraphQLCallTemplateSchema.parse(manualCallTemplate);
    try {
      ensureSecureUrl(template.url, 'GraphQL manual discovery');
      const headers = await this.prepareHeaders(template);
      const data: IntrospectionQuery = await this.execute(template.url, headers, { query: getIntrospectionQuery() });
      const schema = buildClientSchema(data);

      const tools: Tool[] = [];
      for (const rootType of [schema.getQueryType(), schema.getMutationType(), schema.getSubscriptionType()]) {
        for (const field of Object.values(rootType?.getFields() ?? {})) {
          tools.push({
            name: field.name,
            description: field.description ?? '',
            inputs: { type: 'object' },
            outputs: { type: 'object' },
            tags: [],
            tool_call_template: template,
          });
        }
      }
      return {
        manualCallTemplate: template,
        manual: new UtcpManualSerializer().validateDict({ tools }),
        success: true,
        errors: [],
      };
    } catch (e: any) {
      return {
        manualCallTemplate: template,
        manual: new UtcpManualSerializer().validateDict({ manual_version: '0.0.0', tools: [] }),
        success: false,
        errors: [e.message],
      };
    }
  }

  async deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void> {}

  async callTool(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): Promise<any> {
    const template = GraphQLCallTemplateSchema.parse(toolCallTemplate);
    ensureSecureUrl(template.url, 'GraphQL tool invocation');
    const headers = await this.prepareHeaders(template, toolArgs);

    const headerFields = template.header_fields ?? [];
    const variables = Object.fromEntries(Object.entries(toolArgs).filter(([k]) => !headerFields.includes(k)));

    let query = template.query;
    if (!query) {
      const fieldName = toolName.includes('.') ? toolName.slice(toolName.indexOf('.') + 1) : toolName;
      const keys = Object.keys(variables);
      const varDefs = keys.length ? `(${keys.map(k => `$${k}: ${template.variable_types?.[k] ?? 'String'}`).join(', ')})` : '';
      const argPass = keys.length ? `(${keys.map(k => `${k}: $${k}`).join(', ')})` : '';
      const operation = [template.operation_type, template.operation_name].filter(Boolean).join(' ');
      query = `${operation}${varDefs} { ${fieldName}${argPass} }`;
    }

    return this.execute(template.url, headers, {
      query,
      variables,
      ...(template.operation_name ? { operationName: template.operation_name } : {}),
    });
  }

  async *callToolStreaming(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): AsyncGenerator<any, void, unknown> {
    yield await this.callTool(caller, toolName, toolArgs, toolCallTemplate);
  }

  async close(): Promise<void> {
    this.oauthTokens.clear();
  }
}
