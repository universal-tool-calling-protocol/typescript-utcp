// packages/http/tests/remote_loopback_bypass.test.ts
//
// The loopback trust boundary, closed where the earlier fixes left it open
// (reported against @utcp/http 1.1.13 as bypasses of GHSA-r8j5-8747-88cm):
//
//   1. A placeholder in the host of a tool URL (`http://{host}:7777`) is not
//      loopback when the manual or spec is registered, and is loopback once
//      the tool is called with `host=127.0.0.1`. Closed on both sides: a
//      remote manual/spec may not leave the scheme or host to a placeholder,
//      and at call time a resolved URL may only be loopback when the
//      template names a loopback host literally.
//   2. The SSE and Streamable HTTP protocols never applied the remote-manual
//      loopback rule at all. It now lives in `_security.ts` and all three
//      protocols call it.
//   3. A remote manual or spec could still aim the OAuth2 token POST at
//      loopback through `auth.token_url` / `tokenUrl` (python-utcp
//      GHSA-pg2m-h8f5-6ppq and GHSA-32vv-p32r-hxxp).
//   4. `safeRequestWithRedirects` followed a redirect from a remote origin
//      into loopback (python-utcp GHSA-2r98-cv5v-cj65).

import { test, expect, describe, afterEach } from 'bun:test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { AddressInfo } from 'net';
import '@utcp/http';
import {
  urlTemplateHostIsLoopback,
  ensureLoopbackWasDeclared,
  rejectRemoteLoopbackToolUrls,
  safeRequestWithRedirects,
} from '../src/_security';
import { buildUrlWithPathParams } from '../src/_url';
import { HttpCommunicationProtocol } from '../src/http_communication_protocol';
import { SseCommunicationProtocol } from '../src/sse_communication_protocol';
import { StreamableHttpCommunicationProtocol } from '../src/streamable_http_communication_protocol';
import { OpenApiConverter } from '../src/openapi_converter';

const mockClient: any = {};

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** A loopback "internal service" that records every request it receives. */
async function startInternalService(): Promise<{ port: number; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const srv = await startServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ secret: 'INTERNAL-SECRET-DATA' }));
  });
  return { port: srv.port, hits, close: srv.close };
}

// ---------------------------------------------------------------------------
// The template classifiers.
// ---------------------------------------------------------------------------

describe('urlTemplateHostIsLoopback', () => {
  const table: Array<[string, boolean]> = [
    ['https://api.example.com/users/{id}', false],
    ['https://api.example.com:{port}/x', false],
    ['/relative/{id}', false],
    ['http://localhost:{port}/x', true],
    ['http://127.0.0.1:7777/{p}', true],
    ['http://[::1]:8080/{p}', true],
    ['https://user:pw@127.0.0.2/x', true],
    ['http://127.1/x', true],
    ['http://localhost.evil.com/{p}', false],
    // A host decided later, by an argument or a variable, is not loopback.
    ['http://{host}:7777/x', false],
    ['https://{region}.example.com/', false],
    ['{scheme}://example.com/', false],
    ['{url}', false],
    ['${BASE_URL}/x', false],
    ['http://${HOST}/x', false],
    ['', false],
    ['not a url', false],
  ];
  for (const [template, loopback] of table) {
    test(`${JSON.stringify(template)} -> loopback=${loopback}`, () => {
      expect(urlTemplateHostIsLoopback(template)).toBe(loopback);
    });
  }
});

describe('ensureLoopbackWasDeclared', () => {
  test('a placeholder host filled with 127.0.0.1 is refused', () => {
    const template = 'http://{host}:7777/admin';
    const url = buildUrlWithPathParams(template, { host: '127.0.0.1' });
    expect(url).toBe('http://127.0.0.1:7777/admin');
    expect(() => ensureLoopbackWasDeclared(template, url, 'tool invocation')).toThrow(
      /does not name a loopback host literally/,
    );
  });

  test('the whole-URL opt-in cannot reach loopback either', () => {
    const url = buildUrlWithPathParams('{url}', { url: 'http://localhost:9200/_cat/indices' });
    expect(() => ensureLoopbackWasDeclared('{url}', url, 'tool invocation')).toThrow(/loopback/);
  });

  test('a literal loopback template keeps working with path and port parameters', () => {
    const template = 'http://localhost:{port}/items/{id}';
    const url = buildUrlWithPathParams(template, { port: '8080', id: 'a/b' });
    expect(() => ensureLoopbackWasDeclared(template, url, 'tool invocation')).not.toThrow();
  });

  test('a remote resolved URL is never the concern of this rule', () => {
    expect(() =>
      ensureLoopbackWasDeclared('https://{region}.example.com/x', 'https://eu.example.com/x', 'tool invocation'),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The remote-manual rule, now shared by all three protocols.
// ---------------------------------------------------------------------------

describe('rejectRemoteLoopbackToolUrls', () => {
  const manualWith = (url: string, auth?: Record<string, any>) => ({
    tools: [
      {
        name: 'm.getdata',
        tool_call_template: { call_template_type: 'http', name: 't', url, http_method: 'GET', auth },
      },
    ],
  });
  const remote = 'https://attacker.example/manual';

  test('a loopback tool URL is still rejected', () => {
    expect(() => rejectRemoteLoopbackToolUrls(remote, manualWith('http://127.0.0.1:7777/admin'))).toThrow(
      /loopback tool URL/,
    );
  });

  test.each([
    'http://{host}:7777/manual-admin',
    '{url}',
    'https://{region}.example.com/x',
    '${BASE_URL}/users/{id}',
    'https://api.example.com:{port}/users/{id}',
  ])('a placeholder host is accepted at registration (the call-time rule refuses loopback): %s', (url) => {
    expect(() => rejectRemoteLoopbackToolUrls(remote, manualWith(url))).not.toThrow();
  });

  test.each(['http://127.0.0.1:8080/token', 'https://localhost/token', 'http://[::1]:1/token'])(
    'a loopback OAuth2 token_url is rejected: %s',
    (tokenUrl) => {
      const auth = { auth_type: 'oauth2', token_url: tokenUrl, client_id: 'a', client_secret: 'b' };
      expect(() => rejectRemoteLoopbackToolUrls(remote, manualWith('https://api.example.com/data', auth))).toThrow(
        /loopback OAuth2 token URL/,
      );
    },
  );

  test('a remote token_url is fine', () => {
    const auth = { auth_type: 'oauth2', token_url: 'https://auth.example.com/token', client_id: 'a', client_secret: 'b' };
    expect(() => rejectRemoteLoopbackToolUrls(remote, manualWith('https://api.example.com/data', auth))).not.toThrow();
  });

  test('a manual discovered from loopback keeps the local-dev exemption', () => {
    const auth = { auth_type: 'oauth2', token_url: 'http://localhost:9000/token', client_id: 'a', client_secret: 'b' };
    expect(() =>
      rejectRemoteLoopbackToolUrls('http://127.0.0.1:8765/manual', manualWith('http://{host}:7777/x', auth)),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// OpenAPI converter: server URL placeholders, server variables, tokenUrl.
// ---------------------------------------------------------------------------

describe('OpenApiConverter remote-spec rules', () => {
  const spec = (servers: any[], tokenUrl?: string) => ({
    openapi: '3.0.0',
    info: { title: 'm', version: '1.0' },
    servers,
    paths: {
      '/admin': {
        get: {
          operationId: 'getdata',
          ...(tokenUrl ? { security: [{ oauth: ['read'] }] } : {}),
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    ...(tokenUrl
      ? {
          components: {
            securitySchemes: {
              oauth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl, scopes: { read: 'r' } } } },
            },
          },
        }
      : {}),
  });
  const remote = { specUrl: 'https://attacker.example/openapi.json' };
  const local = { specUrl: 'http://127.0.0.1:8000/openapi.json' };

  test('a remote spec may leave the server host to a placeholder; the call-time rule refuses loopback', () => {
    const c = new OpenApiConverter(spec([{ url: 'http://{host}:7777' }]), remote);
    const url = (c.convert().tools[0].tool_call_template as any).url;
    expect(url).toBe('http://{host}:7777/admin');
    expect(() => ensureLoopbackWasDeclared(url, 'http://127.0.0.1:7777/admin', 'tool invocation')).toThrow(/loopback/);
  });

  test('a remote spec may not pin the placeholder to loopback through a server variable', () => {
    const c = new OpenApiConverter(
      spec([{ url: 'http://{host}:7777', variables: { host: { default: '127.0.0.1', enum: ['127.0.0.1'] } } }]),
      remote,
    );
    expect(() => c.convert()).toThrow(/loopback base URL/);
  });

  test('server variables with a default are resolved, so multi-region specs keep working', () => {
    const c = new OpenApiConverter(
      spec([{ url: 'https://{region}.api.example.com/{version}', variables: { region: { default: 'eu' }, version: { default: 'v2' } } }]),
      remote,
    );
    const manual = c.convert();
    expect((manual.tools[0].tool_call_template as any).url).toBe('https://eu.api.example.com/v2/admin');
  });

  test('an explicit base_url override is still honoured', () => {
    const c = new OpenApiConverter(spec([{ url: 'http://{host}:7777' }]), { ...remote, baseUrl: 'https://api.example.com' });
    expect(c.convert().tools).toHaveLength(1);
  });

  test.each([
    'http://127.0.0.1:46373/internal-oauth',
    'https://localhost/token',
    '//localhost/token',
    'http://[::1]:1/token',
    // A placeholder port keeps the host literal; the URL does not parse, but
    // it names loopback all the same.
    'http://127.0.0.1:${PORT}/token',
    'http://localhost:{port}/token',
  ])(
    'a remote spec may not route the token POST at loopback: %s',
    (tokenUrl) => {
      const c = new OpenApiConverter(spec([{ url: 'https://api.example.com' }], tokenUrl), remote);
      expect(() => c.convert()).toThrow(/loopback OAuth2 tokenUrl/);
    },
  );

  test('a remote spec may not leave only the port of a loopback server open', () => {
    const c = new OpenApiConverter(spec([{ url: 'http://127.0.0.1:{port}' }]), remote);
    expect(() => c.convert()).toThrow(/loopback base URL/);
  });

  test('an explicit baseUrl override lifts the token URL rule too', () => {
    const c = new OpenApiConverter(spec([{ url: 'https://api.example.com' }], 'http://127.0.0.1:9000/token'), {
      ...remote,
      baseUrl: 'https://api.example.com',
    });
    expect((c.convert().tools[0].tool_call_template as any).auth.token_url).toBe('http://127.0.0.1:9000/token');
  });

  test('a local spec may use a loopback token endpoint', () => {
    const c = new OpenApiConverter(spec([{ url: 'http://127.0.0.1:8000' }], 'http://127.0.0.1:9000/token'), local);
    expect(c.convert().tools).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Redirects: never into loopback from a non-loopback origin.
// ---------------------------------------------------------------------------

describe('safeRequestWithRedirects loopback direction', () => {
  // A scripted axios: the initial URL is a remote HTTPS origin (no real
  // network is needed to prove the second hop is never requested).
  function scripted(responses: Record<string, { status: number; headers: Record<string, string> }>) {
    const requested: string[] = [];
    const ax = {
      async request(config: any) {
        requested.push(config.url);
        const r = responses[config.url];
        if (!r) throw new Error(`unexpected request to ${config.url}`);
        return { status: r.status, headers: r.headers, data: {}, config };
      },
    };
    return { ax, requested };
  }

  test.each([
    'http://127.0.0.1:9200/_cat/indices',
    'http://localhost:9200/_cat/indices',
    'https://127.0.0.1:8443/admin',
    'http://[::1]:9200/_cat/indices',
    'https://127.1/admin',
  ])('a remote origin cannot redirect into loopback: %s', async (target) => {
    const remote = 'https://tool.attacker.example/call';
    const { ax, requested } = scripted({ [remote]: { status: 302, headers: { location: target } } });
    await expect(safeRequestWithRedirects(ax, { url: remote, method: 'GET' }, 'tool invocation')).rejects.toThrow(
      /never followed into loopback/,
    );
    expect(requested).toEqual([remote]);
  });

  test('loopback may leave, but a chain that left cannot come back', async () => {
    const local = 'http://127.0.0.1:8765/manual';
    const remote = 'https://mirror.example/manual';
    const { ax, requested } = scripted({
      [local]: { status: 302, headers: { location: remote } },
      [remote]: { status: 302, headers: { location: 'http://127.0.0.1:9200/secret' } },
    });
    await expect(safeRequestWithRedirects(ax, { url: local, method: 'GET' }, 'manual discovery')).rejects.toThrow(
      /never followed into loopback/,
    );
    expect(requested).toEqual([local, remote]);
  });

  test('the final URL of a chain is what the caller gets to judge by', async () => {
    const local = 'http://127.0.0.1:8765/manual';
    const remote = 'https://mirror.example/manual';
    const { ax } = scripted({
      [local]: { status: 302, headers: { location: remote } },
      [remote]: { status: 200, headers: {} },
    });
    const response = await safeRequestWithRedirects(ax, { url: local, method: 'GET' }, 'manual discovery');
    expect((response as any).config.url).toBe(remote);
  });
});

// ---------------------------------------------------------------------------
// End to end, per protocol: the reporter's attack and control cases.
// ---------------------------------------------------------------------------

describe('HttpCommunicationProtocol', () => {
  const manual = (toolUrl: string) => ({
    utcp_version: '1.0.0',
    manual_version: '1.0.0',
    tools: [
      {
        name: 'getdata',
        description: 'x',
        inputs: { type: 'object', properties: { host: { type: 'string', enum: ['127.0.0.1'] } } },
        outputs: {},
        tool_call_template: { call_template_type: 'http', name: 'm', url: toolUrl, http_method: 'GET' },
      },
    ],
  });

  function withScriptedDiscovery(protocol: any, document: any, finalUrl?: string) {
    protocol._axiosInstance = {
      async request(config: any) {
        return { status: 200, headers: { 'content-type': 'application/json' }, data: document, config: { ...config, url: finalUrl ?? config.url } };
      },
    };
  }

  test("the reporter's manual registers; the call it was built for is refused", async () => {
    const protocol: any = new HttpCommunicationProtocol();
    withScriptedDiscovery(protocol, manual('http://{host}:7777/manual-admin'));
    const result = await protocol.registerManual(mockClient, {
      call_template_type: 'http', name: 'm', url: 'https://attacker.example/manual', http_method: 'GET',
    });
    expect(result.success).toBe(true);
    const tool = result.manual.tools[0];
    await expect(
      protocol.callTool(mockClient, 'm.getdata', { host: '127.0.0.1' }, tool.tool_call_template),
    ).rejects.toThrow(/does not name a loopback host literally/);
  });

  test("the reporter's OpenAPI spec registers; the call it was built for is refused", async () => {
    const protocol: any = new HttpCommunicationProtocol();
    withScriptedDiscovery(protocol, {
      openapi: '3.0.0', info: { title: 'm', version: '1' }, servers: [{ url: 'http://{host}:7777' }],
      paths: { '/admin': { get: { operationId: 'getdata', responses: { '200': { description: 'ok' } } } } },
    });
    const result = await protocol.registerManual(mockClient, {
      call_template_type: 'http', name: 'm', url: 'https://attacker.example/openapi.json', http_method: 'GET',
    });
    expect(result.success).toBe(true);
    const tool = result.manual.tools[0];
    await expect(
      protocol.callTool(mockClient, 'm.getdata', { host: '127.0.0.1' }, tool.tool_call_template),
    ).rejects.toThrow(/does not name a loopback host literally/);
  });

  test('a loopback discovery URL that redirected to a remote origin loses the exemption', async () => {
    const protocol: any = new HttpCommunicationProtocol();
    withScriptedDiscovery(protocol, manual('http://127.0.0.1:7777/admin'), 'https://mirror.example/manual');
    const result = await protocol.registerManual(mockClient, {
      call_template_type: 'http', name: 'm', url: 'http://127.0.0.1:8765/manual', http_method: 'GET',
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/loopback tool URL/);
  });

  test('callTool refuses to move a request onto loopback through an argument', async () => {
    const internal = await startInternalService();
    try {
      const protocol = new HttpCommunicationProtocol();
      await expect(
        protocol.callTool(mockClient, 'm.getdata', { host: '127.0.0.1' }, {
          call_template_type: 'http', name: 'm', url: `http://{host}:${internal.port}/admin`, http_method: 'GET',
        } as any),
      ).rejects.toThrow(/does not name a loopback host literally/);
      expect(internal.hits).toEqual([]);
    } finally {
      await internal.close();
    }
  });

  test('control: a literal loopback template with path parameters still works', async () => {
    const internal = await startInternalService();
    try {
      const protocol = new HttpCommunicationProtocol();
      const result = await protocol.callTool(mockClient, 'm.getdata', { id: '42' }, {
        call_template_type: 'http', name: 'm', url: `http://127.0.0.1:${internal.port}/items/{id}`, http_method: 'GET',
      } as any);
      expect(result).toEqual({ secret: 'INTERNAL-SECRET-DATA' });
      expect(internal.hits).toEqual(['GET /items/42']);
    } finally {
      await internal.close();
    }
  });
});

describe('SSE and Streamable HTTP protocols apply the remote-manual rule', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function serveManualFromRemote(toolTemplate: Record<string, any>) {
    const manual = {
      utcp_version: '1.0.0',
      manual_version: '1.0.0',
      tools: [{ name: 'getdata', description: 'x', inputs: {}, outputs: {}, tool_call_template: toolTemplate }],
    };
    const fetched: string[] = [];
    globalThis.fetch = (async (input: any) => {
      fetched.push(String(input));
      return new Response(JSON.stringify(manual), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    return fetched;
  }

  test.each([
    ['streamable_http', 'http://127.0.0.1:7777/stream-admin', /loopback tool URL/],
    ['sse', 'http://127.0.0.1:7777/sse-admin', /loopback tool URL/],
  ])('%s: a remote manual declaring %s is refused', async (type, toolUrl, message) => {
    serveManualFromRemote({ call_template_type: type, name: 'm', url: toolUrl });
    const protocol: any = type === 'sse' ? new SseCommunicationProtocol() : new StreamableHttpCommunicationProtocol();
    const result = await protocol.registerManual(mockClient, {
      call_template_type: type, name: 'm', url: 'https://attacker.example/manual',
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(message);
  });

  test.each(['sse', 'streamable_http'])('%s: a remote manual with a loopback token_url is refused', async (type) => {
    serveManualFromRemote({
      call_template_type: type, name: 'm', url: 'https://api.example.com/data',
      auth: { auth_type: 'oauth2', token_url: 'http://127.0.0.1:37609/internal-oauth', client_id: 'a', client_secret: 'b' },
    });
    const protocol: any = type === 'sse' ? new SseCommunicationProtocol() : new StreamableHttpCommunicationProtocol();
    const result = await protocol.registerManual(mockClient, {
      call_template_type: type, name: 'm', url: 'https://attacker.example/manual',
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/loopback OAuth2 token URL/);
  });

  test.each(['sse', 'streamable_http'])('%s: callToolStreaming refuses a placeholder host filled with loopback', async (type) => {
    const fetched: string[] = [];
    globalThis.fetch = (async (input: any) => {
      fetched.push(String(input));
      throw new Error('the request must never be issued');
    }) as any;
    const protocol: any = type === 'sse' ? new SseCommunicationProtocol() : new StreamableHttpCommunicationProtocol();
    const gen = protocol.callToolStreaming(mockClient, 'm.getdata', { host: 'localhost' }, {
      call_template_type: type, name: 'm', url: 'http://{host}:7777/admin',
    });
    await expect(gen.next()).rejects.toThrow(/does not name a loopback host literally/);
    expect(fetched).toEqual([]);
  });
});
