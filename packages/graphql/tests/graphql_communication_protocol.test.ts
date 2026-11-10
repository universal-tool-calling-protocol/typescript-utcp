import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import express from 'express';
import { Server } from 'http';
import { buildSchema, graphql } from 'graphql';
import { GraphQLCommunicationProtocol, GraphQLCallTemplate } from "@utcp/graphql";
import { IUtcpClient } from "@utcp/sdk";

const schema = buildSchema(`
  type User { id: ID! name: String! }
  type Query {
    "Greets someone"
    hello(name: String): String
    user(id: ID!): User
    sessionId: String
    fail: String
  }
  type Mutation { rename(id: ID!, name: String!): User }
`);

let lastHeaders: Record<string, any> = {};
const rootValue = {
  hello: ({ name }: { name?: string }) => `Hello, ${name ?? 'world'}`,
  user: ({ id }: { id: string }) => ({ id, name: 'Ada' }),
  sessionId: () => lastHeaders['x-session-id'] ?? null,
  fail: () => { throw new Error('boom'); },
  rename: ({ id, name }: { id: string; name: string }) => ({ id, name }),
};

let server: Server;
let url: string;
const caller = {} as IUtcpClient;
const protocol = new GraphQLCommunicationProtocol();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post('/graphql', async (req, res) => {
    lastHeaders = req.headers;
    const result = await graphql({ schema, rootValue, source: req.body.query, variableValues: req.body.variables, operationName: req.body.operationName });
    res.status(result.errors && !result.data ? 400 : 200).json(result);
  });
  let tokens = 0;
  app.post('/token', express.urlencoded({ extended: false }), (req, res) => {
    res.json({ access_token: `tok${++tokens}`, expires_in: req.body.scope === 'short' ? 0 : 3600 });
  });
  app.post('/html', (_req, res) => {
    res.type('html').send('<html></html>');
  });
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  url = `http://localhost:${(server.address() as any).port}/graphql`;
});

afterAll(() => {
  server.close();
});

const template = (extra: Partial<GraphQLCallTemplate> = {}): GraphQLCallTemplate => ({
  name: 'test',
  call_template_type: 'graphql',
  url,
  operation_type: 'query',
  ...extra,
});

describe('GraphQLCommunicationProtocol', () => {
  test('discovers queries and mutations via introspection', async () => {
    const result = await protocol.registerManual(caller, template());
    expect(result.success).toBe(true);
    const names = result.manual.tools.map(t => t.name);
    expect(names).toEqual(['hello', 'user', 'sessionId', 'fail', 'rename']);
    expect(result.manual.tools[0]!.description).toBe('Greets someone');
  });

  test('runs a custom query with variables', async () => {
    const t = template({ query: 'query ($id: ID!) { user(id: $id) { id name } }' });
    expect(await protocol.callTool(caller, 'test.user', { id: '7' }, t)).toEqual({ user: { id: '7', name: 'Ada' } });
  });

  test('auto-generates a query from the tool name', async () => {
    expect(await protocol.callTool(caller, 'test.hello', { name: 'UTCP' }, template())).toEqual({ hello: 'Hello, UTCP' });
  });

  test('sends header_fields as headers, not variables', async () => {
    const t = template({ header_fields: ['x-session-id'] });
    expect(await protocol.callTool(caller, 'test.sessionId', { 'x-session-id': 'abc' }, t)).toEqual({ sessionId: 'abc' });
    expect(await protocol.callTool(caller, 'test.sessionId', { 'x-session-id': 42 }, t)).toEqual({ sessionId: '42' });
  });

  test('names the generated operation after operation_name', async () => {
    const t = template({ operation_name: 'Greet' });
    expect(await protocol.callTool(caller, 'test.hello', { name: 'UTCP' }, t)).toEqual({ hello: 'Hello, UTCP' });
  });

  test('applies api_key and basic auth', async () => {
    await protocol.callTool(caller, 'test.hello', {}, template({ auth: { auth_type: 'api_key', api_key: 'k', var_name: 'X-Api-Key', location: 'header' } }));
    expect(lastHeaders['x-api-key']).toBe('k');
    await protocol.callTool(caller, 'test.hello', {}, template({ auth: { auth_type: 'basic', username: 'u', password: 'p' } }));
    expect(lastHeaders['authorization']).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });

  test('fetches, caches and refreshes OAuth2 tokens', async () => {
    const oauth = (scope: string) => template({
      auth: { auth_type: 'oauth2', token_url: url.replace('/graphql', '/token'), client_id: 'id', client_secret: 'secret', scope },
    });
    await protocol.callTool(caller, 'test.hello', {}, oauth('long'));
    const first = lastHeaders['authorization'];
    await protocol.callTool(caller, 'test.hello', {}, oauth('long'));
    expect(lastHeaders['authorization']).toBe(first);

    await protocol.callTool(caller, 'test.hello', {}, oauth('short'));
    const expired = lastHeaders['authorization'];
    await protocol.callTool(caller, 'test.hello', {}, oauth('short'));
    expect(lastHeaders['authorization']).not.toBe(expired);
  });

  test('throws on a non-JSON response', async () => {
    await expect(protocol.callTool(caller, 'test.hello', {}, template({ url: url.replace('/graphql', '/html') }))).rejects.toThrow('not JSON');
  });

  test('throws on GraphQL errors', async () => {
    await expect(protocol.callTool(caller, 'test.fail', {}, template())).rejects.toThrow('boom');
    await expect(protocol.callTool(caller, 'test.user', { id: '1' }, template({ query: '{ nope }' }))).rejects.toThrow('nope');
  });

  test('rejects insecure URLs', async () => {
    for (const bad of ['http://example.com/graphql', 'http://localhost.evil.com/graphql']) {
      await expect(protocol.callTool(caller, 'test.hello', {}, template({ url: bad }))).rejects.toThrow('Security error');
      expect((await protocol.registerManual(caller, template({ url: bad }))).success).toBe(false);
    }
    const auth = { auth_type: 'oauth2' as const, token_url: 'http://example.com/token', client_id: 'id', client_secret: 'secret' };
    await expect(protocol.callTool(caller, 'test.hello', {}, template({ auth }))).rejects.toThrow('Security error');
  });
});
