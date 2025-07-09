import nock from 'nock';
import { HttpClientTransport } from '../../../src/client/transport-interfaces/http-transport';
import { HttpProvider } from '../../../src/shared/provider';
import { ApiKeyAuth, BasicAuth } from '../../../src/shared/auth';
import { OAuth2Auth } from '../../../src/shared/auth';

const BASE_URL = 'http://localhost';

describe('HttpClientTransport', () => {
  let transport: HttpClientTransport;
  let logger: jest.Mock;

  beforeEach(() => {
    logger = jest.fn();
    transport = new HttpClientTransport(logger);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('register_tool_provider', () => {
    it('should register a provider and discover tools from a UTCP manual', async () => {
      const provider: HttpProvider = {
        name: 'test-provider',
        provider_type: 'http',
        url: `${BASE_URL}/tools`,
        http_method: 'GET',
      } as HttpProvider;

      const utcpManual = {
        version: '1.0',
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            provider: provider
          },
        ],
      };

      nock(BASE_URL).get('/tools').reply(200, utcpManual);

      const tools = await transport.register_tool_provider(provider);

      expect(tools).toHaveLength(1);
      expect(tools?.[0]?.name).toBe('test_tool');

    });

    it('should handle HTTP errors during registration', async () => {
        const provider: HttpProvider = {
            name: 'error-provider',
            provider_type: 'http',
            url: `${BASE_URL}/error`,
            http_method: 'GET',
        } as HttpProvider;

        nock(BASE_URL).get('/error').reply(500, 'Internal Server Error');

        const tools = await transport.register_tool_provider(provider);

        expect(tools).toEqual([]);

    });

  });

  describe('deregister_tool_provider', () => {
    it('should be a no-op', async () => {
      const provider: HttpProvider = { name: 'test', provider_type: 'http', url: BASE_URL, http_method: 'GET' } as HttpProvider;
      await transport.deregister_tool_provider(provider);
      // No assertion needed, just checking that it doesn't throw.
    });
  });

  describe('call_tool', () => {
    const toolProvider: HttpProvider = {
      name: 'tool-provider',
      provider_type: 'http',
      url: `${BASE_URL}/tool`,
      http_method: 'GET',
    } as HttpProvider;

    it('should make a basic tool call', async () => {
      nock(BASE_URL).get('/tool').query({ param1: 'value1' }).reply(200, { result: 'success' });

      const result = await transport.call_tool('test_tool', { param1: 'value1' }, toolProvider);

      expect(result).toEqual({ result: 'success' });
    });

    it('should handle API key authentication', async () => {
        const auth: ApiKeyAuth = { auth_type: 'api_key', var_name: 'X-API-Key', api_key: 'test-key' } as ApiKeyAuth;
        const provider: HttpProvider = { ...toolProvider, auth } as HttpProvider;

        nock(BASE_URL)
            .get('/tool')
            .query(true)
            .matchHeader('X-API-Key', 'test-key')
            .reply(200, { result: 'success' });

        const result = await transport.call_tool('test_tool', { param1: 'value1' }, provider);

        expect(result).toEqual({ result: 'success' });
    });

    it('should handle Basic authentication', async () => {
        const auth: BasicAuth = { auth_type: 'basic', username: 'user', password: 'pass' } as BasicAuth;
        const provider: HttpProvider = { ...toolProvider, auth } as HttpProvider;

        nock(BASE_URL)
            .get('/tool')
            .query(true)
            .basicAuth({ user: 'user', pass: 'pass' })
            .reply(200, { result: 'success' });

        const result = await transport.call_tool('test_tool', { param1: 'value1' }, provider);

        expect(result).toEqual({ result: 'success' });
    });

    it('should handle OAuth2 authentication with credentials in body', async () => {
        const auth: OAuth2Auth = {
            auth_type: 'oauth2',
            token_url: `${BASE_URL}/token`,
            client_id: 'id',
            client_secret: 'secret',
        } as OAuth2Auth;
        const provider: HttpProvider = { ...toolProvider, auth } as HttpProvider;

        nock(BASE_URL)
            .post('/token', 'grant_type=client_credentials&client_id=id&client_secret=secret&scope=')
            .reply(200, { access_token: 'test-token' });

        nock(BASE_URL)
            .get('/tool')
            .query(true)
            .matchHeader('Authorization', 'Bearer test-token')
            .reply(200, { result: 'success' });

        const result = await transport.call_tool('test_tool', { param1: 'value1' }, provider);

        expect(result).toEqual({ result: 'success' });
    });
    
    it('should handle body_field for POST requests', async () => {
        const provider: HttpProvider = {
            ...toolProvider,
            http_method: 'POST',
            body_field: 'data',
        };
        const body = { key: 'value' };

        nock(BASE_URL)
            .post('/tool', body)
            .query({ param1: 'value1' })
            .reply(200, { result: 'success' });

        const result = await transport.call_tool('test_tool', { param1: 'value1', data: body }, provider);

        expect(result).toEqual({ result: 'success' });
    });

    it('should handle header_fields', async () => {
        const provider: HttpProvider = {
            ...toolProvider,
            header_fields: ['X-Custom-Header'],
        };

        nock(BASE_URL)
            .get('/tool')
            .query(true)
            .matchHeader('X-Custom-Header', 'custom-value')
            .reply(200, { result: 'success' });

        const result = await transport.call_tool('test_tool', { param1: 'value1', 'X-Custom-Header': 'custom-value' }, provider);

        expect(result).toEqual({ result: 'success' });
    });

    it('should throw an error on failed tool call', async () => {
        nock(BASE_URL).get('/tool').query(true).reply(500);

        await expect(transport.call_tool('test_tool', { param1: 'value1' }, toolProvider)).rejects.toThrow();

    });

  });
});
