import nock from 'nock';
import { HttpClientTransport } from '../../../src/client/transport-interfaces/http-transport';
import { HttpProvider } from '../../../src/shared/provider';
import { ApiKeyAuth, BasicAuth, OAuth2Auth } from '../../../src/shared/auth';
import * as http from 'http';
import express from 'express';
import axios from 'axios';

const BASE_URL = 'http://localhost:8888';

describe('HttpClientTransport', () => {
  let transport: HttpClientTransport;
  let logger: jest.Mock;
  let server: http.Server | null = null;
  let expressApp: express.Express | null = null;
  let serverPort = 0;

  beforeEach(() => {
    logger = jest.fn();
    transport = new HttpClientTransport(logger);
  });

  afterEach(() => {
    nock.cleanAll();
    if (server) {
      server.close();
      server = null;
      expressApp = null;
    }
  });
  
  // Helper to create a local test server for path parameter tests
  async function createTestServer(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        expressApp = express();
        
        // Path parameter handler route
        if (expressApp) {
          expressApp.get('/users/:userId/posts/:postId', (req, res) => {
            const userId = req.params.userId;
            const postId = req.params.postId;
            const limit = req.query.limit || '10';
            
            res.json({
              user_id: userId,
              post_id: postId,
              limit: limit,
              message: `Retrieved post ${postId} for user ${userId} with limit ${limit}`
            });
          });
          
          server = expressApp.listen(0, () => {
            const address = server?.address() as { port: number };
            serverPort = address.port;
            resolve(serverPort);
          });
        } else {
          reject(new Error('Failed to create Express app'));
        }
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  describe('register_tool_provider', () => {
    it('should register a provider and discover tools from a UTCP manual', async () => {
      const provider: HttpProvider = {
        name: 'test-provider',
        provider_type: 'http',
        url: `${BASE_URL}/tools`,
        http_method: 'GET',
      } as HttpProvider;

      // Create a valid UTCP manual structure that matches the schema
      const utcpManual = {
        version: '1.0',
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            inputs: {
              type: 'object',
              properties: {}
            },
            outputs: {
              type: 'object',
              properties: {}
            },
            tags: [],
            tool_provider: {
              name: 'test-provider',
              provider_type: 'http',
              url: `${BASE_URL}/tool`,
              http_method: 'GET'
            }
          },
        ],
      };

      // Log the request for debugging
      nock.emitter.on('no match', (req) => {
        console.log('No match for request:', req.path, req.method, req.options);
      });
      
      // Set up nock interceptor
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

  describe('_buildUrlWithPathParams', () => {
    it('should build URLs with path parameters', () => {
      // Test 1: Simple single parameter
      const args1 = { user_id: '123', limit: '10' };
      const url1 = (transport as any)._buildUrlWithPathParams('https://api.example.com/users/{user_id}', args1);
      expect(url1).toBe('https://api.example.com/users/123');
      expect(args1).toEqual({ limit: '10' }); // Path parameter should be removed
      
      // Test 2: Multiple path parameters (like OpenLibrary API)
      const args2 = { key_type: 'isbn', value: '9780140328721', format: 'json' };
      const url2 = (transport as any)._buildUrlWithPathParams('https://openlibrary.org/api/volumes/brief/{key_type}/{value}.json', args2);
      expect(url2).toBe('https://openlibrary.org/api/volumes/brief/isbn/9780140328721.json');
      expect(args2).toEqual({ format: 'json' }); // Path parameters should be removed
      
      // Test 3: Complex URL with multiple parameters
      const args3 = { user_id: '123', post_id: '456', comment_id: '789', limit: '10', offset: '0' };
      const url3 = (transport as any)._buildUrlWithPathParams('https://api.example.com/users/{user_id}/posts/{post_id}/comments/{comment_id}', args3);
      expect(url3).toBe('https://api.example.com/users/123/posts/456/comments/789');
      expect(args3).toEqual({ limit: '10', offset: '0' }); // Path parameters should be removed
      
      // Test 4: URL with no path parameters
      const args4 = { param1: 'value1', param2: 'value2' };
      const url4 = (transport as any)._buildUrlWithPathParams('https://api.example.com/endpoint', args4);
      expect(url4).toBe('https://api.example.com/endpoint');
      expect(args4).toEqual({ param1: 'value1', param2: 'value2' }); // Arguments should remain unchanged
    });
    
    it('should throw an error for missing path parameters', () => {
      // Test 5: Error case - missing parameter
      const args5 = { user_id: '123' };
      expect(() => {
        (transport as any)._buildUrlWithPathParams('https://api.example.com/users/{user_id}/posts/{post_id}', args5);
      }).toThrow('Missing required path parameter: post_id');
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
        const auth: ApiKeyAuth = { 
            auth_type: 'api_key', 
            var_name: 'X-API-Key', 
            api_key: 'test-key',
            location: 'header' 
        } as ApiKeyAuth;
        
        const provider: HttpProvider = { 
            ...toolProvider, 
            auth 
        } as HttpProvider;

        // Define the nock scope with debug logging to diagnose issues
        const scope = nock(BASE_URL, { allowUnmocked: false })
            .get('/tool')
            .query({ param1: 'value1' })
            .matchHeader('X-API-Key', 'test-key')
            .reply(200, { result: 'success' });

        const result = await transport.call_tool('test_tool', { param1: 'value1' }, provider);

        expect(result).toEqual({ result: 'success' });
        expect(scope.isDone()).toBe(true);
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
    
    it('should handle OAuth2 authentication with Basic Auth header fallback', async () => {
        const auth: OAuth2Auth = {
            auth_type: 'oauth2',
            token_url: `${BASE_URL}/token_header_auth`,
            client_id: 'id',
            client_secret: 'secret',
        } as OAuth2Auth;
        const provider: HttpProvider = { ...toolProvider, auth } as HttpProvider;

        // First request fails (credentials in body)
        nock(BASE_URL)
            .post('/token_header_auth', 'grant_type=client_credentials&client_id=id&client_secret=secret&scope=')
            .reply(401, { error: 'invalid_client' });
            
        // Second request succeeds (credentials in header)
        nock(BASE_URL)
            .post('/token_header_auth', 'grant_type=client_credentials&scope=')
            .basicAuth({ user: 'id', pass: 'secret' })
            .reply(200, { access_token: 'test-token-header' });

        nock(BASE_URL)
            .get('/tool')
            .query(true)
            .matchHeader('Authorization', 'Bearer test-token-header')
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
    
    it('should handle API key auth in different locations', async () => {
        // Test header location
        const headerAuth: ApiKeyAuth = { 
            auth_type: 'api_key', 
            var_name: 'X-API-Key', 
            api_key: 'test-key',
            location: 'header'
        } as ApiKeyAuth;
        
        const headerProvider: HttpProvider = { ...toolProvider, auth: headerAuth } as HttpProvider;

        nock(BASE_URL)
            .get('/tool')
            .query(true)
            .matchHeader('X-API-Key', 'test-key')
            .reply(200, { result: 'header-success' });

        const headerResult = await transport.call_tool('test_tool', { param1: 'value1' }, headerProvider);
        expect(headerResult).toEqual({ result: 'header-success' });
        
        // Test query location
        const queryAuth: ApiKeyAuth = { 
            auth_type: 'api_key', 
            var_name: 'api_key', 
            api_key: 'test-key',
            location: 'query'
        } as ApiKeyAuth;
        
        const queryProvider: HttpProvider = { ...toolProvider, auth: queryAuth } as HttpProvider;

        nock(BASE_URL)
            .get('/tool')
            .query(params => params.api_key === 'test-key')
            .reply(200, { result: 'query-success' });

        const queryResult = await transport.call_tool('test_tool', { param1: 'value1' }, queryProvider);
        expect(queryResult).toEqual({ result: 'query-success' });
        
        // Test cookie location
        const cookieAuth: ApiKeyAuth = { 
            auth_type: 'api_key', 
            var_name: 'auth_token', 
            api_key: 'test-key',
            location: 'cookie'
        } as ApiKeyAuth;
        
        const cookieProvider: HttpProvider = { ...toolProvider, auth: cookieAuth } as HttpProvider;

        nock(BASE_URL)
            .get('/tool')
            .query(true)
            .matchHeader('Cookie', 'auth_token=test-key')
            .reply(200, { result: 'cookie-success' });

        const cookieResult = await transport.call_tool('test_tool', { param1: 'value1' }, cookieProvider);
        expect(cookieResult).toEqual({ result: 'cookie-success' });
    });
    
    it('should handle missing API key', async () => {
        const auth: ApiKeyAuth = { 
            auth_type: 'api_key', 
            var_name: 'X-API-Key', 
            location: 'header'
        } as ApiKeyAuth;
        
        const provider: HttpProvider = { ...toolProvider, auth } as HttpProvider;

        await expect(transport.call_tool('test_tool', { param1: 'value1' }, provider))
            .rejects.toThrow('API key for ApiKeyAuth not found.');
    });

  });
  
  describe('call_tool with path parameters', () => {
    it('should handle URLs with path parameters', async () => {
      // Create test server for path parameters
      const port = await createTestServer();
      const baseUrl = `http://localhost:${port}`;
      
      // Create provider with path parameters in URL
      const provider: HttpProvider = {
        name: 'test-provider',
        provider_type: 'http',
        url: `${baseUrl}/users/{user_id}/posts/{post_id}`,
        http_method: 'GET'
      } as HttpProvider;
      
      // Call with path parameters
      const result = await transport.call_tool(
        'get_user_post',
        { user_id: '123', post_id: '456', limit: '20' },
        provider
      );
      
      // Verify result
      expect(result.user_id).toBe('123');
      expect(result.post_id).toBe('456');
      expect(result.limit).toBe('20');
      expect(result.message).toBe('Retrieved post 456 for user 123 with limit 20');
    });
    
    it('should throw error for missing path parameters', async () => {
      // Provider with path parameters
      const provider: HttpProvider = {
        name: 'test-provider',
        provider_type: 'http',
        url: 'https://api.example.com/users/{user_id}/posts/{post_id}',
        http_method: 'GET'
      } as HttpProvider;
      
      // Missing post_id parameter
      await expect(transport.call_tool(
        'test_tool',
        { user_id: '123' },
        provider
      )).rejects.toThrow('Missing required path parameter: post_id');
    });
    
    it('should handle OpenLibrary-style URLs', () => {
      // Create a provider with OpenLibrary-style URL
      const provider: HttpProvider = {
        name: 'openlibrary-provider',
        provider_type: 'http',
        url: 'https://openlibrary.org/api/volumes/brief/{key_type}/{value}.json',
        http_method: 'GET'
      } as HttpProvider;
      
      // Test URL building
      const args = { key_type: 'isbn', value: '9780140328721', format: 'json' };
      const url = (transport as any)._buildUrlWithPathParams(provider.url, args);
      
      expect(url).toBe('https://openlibrary.org/api/volumes/brief/isbn/9780140328721.json');
      expect(args).toEqual({ format: 'json' }); // Path parameters should be removed
    });
  });
});
