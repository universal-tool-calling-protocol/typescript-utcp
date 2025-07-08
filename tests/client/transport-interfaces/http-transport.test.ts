import { HttpClientTransport } from '../../../src/client/transport-interfaces/http-transport';
import { Tool } from '../../../src/shared/tool';
import { HttpProvider } from '../../../src/shared/provider';

// Mock axios
jest.mock('axios');
const mockAxios = jest.mocked(require('axios'));

describe('HttpClientTransport', () => {
  let transport: HttpClientTransport;

  beforeEach(() => {
    transport = new HttpClientTransport();
    mockAxios.create.mockReturnValue(mockAxios);
    mockAxios.mockClear();
  });

  describe('canHandle', () => {
    it('should handle HTTP tools', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: [],
        provider: {
          name: 'test_provider',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'GET',
          content_type: 'application/json',
          body_field: 'body'
        }
      };

      expect(transport.canHandle(tool)).toBe(true);
    });

    it('should not handle non-HTTP tools', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: [],
        provider: {
          name: 'test_provider',
          provider_type: 'websocket',
          url: 'wss://example.com'
        }
      };

      expect(transport.canHandle(tool)).toBe(false);
    });
  });

  describe('callTool', () => {
    it('should make HTTP GET request', async () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: [],
        provider: {
          name: 'test_provider',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'GET',
          content_type: 'application/json',
          body_field: 'body'
        }
      };

      const mockResponse = { data: { result: 'success' } };
      mockAxios.mockResolvedValue(mockResponse);

      const result = await transport.callTool(tool, { param: 'value' });

      expect(result).toEqual({ result: 'success' });
      expect(mockAxios).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://example.com',
        headers: {
          'Content-Type': 'application/json'
        },
        params: { param: 'value' }
      });
    });

    it('should make HTTP POST request with body', async () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: [],
        provider: {
          name: 'test_provider',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'POST',
          content_type: 'application/json',
          body_field: 'body'
        }
      };

      const mockResponse = { data: { result: 'success' } };
      mockAxios.mockResolvedValue(mockResponse);

      const result = await transport.callTool(tool, { param: 'value' });

      expect(result).toEqual({ result: 'success' });
      expect(mockAxios).toHaveBeenCalledWith({
        method: 'POST',
        url: 'https://example.com',
        headers: {
          'Content-Type': 'application/json'
        },
        data: { param: 'value' }
      });
    });

    it('should handle API key authentication', async () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: [],
        provider: {
          name: 'test_provider',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'GET',
          content_type: 'application/json',
          body_field: 'body',
          auth: {
            auth_type: 'api_key',
            api_key: 'test-key',
            header_name: 'Authorization',
            header_value_prefix: 'Bearer '
          }
        }
      };

      const mockResponse = { data: { result: 'success' } };
      mockAxios.mockResolvedValue(mockResponse);

      await transport.callTool(tool, {});

      expect(mockAxios).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://example.com',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key'
        }
      });
    });

    it('should handle basic authentication', async () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: [],
        provider: {
          name: 'test_provider',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'GET',
          content_type: 'application/json',
          body_field: 'body',
          auth: {
            auth_type: 'basic',
            username: 'user',
            password: 'pass'
          }
        }
      };

      const mockResponse = { data: { result: 'success' } };
      mockAxios.mockResolvedValue(mockResponse);

      await transport.callTool(tool, {});

      const expectedAuth = Buffer.from('user:pass').toString('base64');
      expect(mockAxios).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://example.com',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${expectedAuth}`
        }
      });
    });

    it('should throw error for unsupported tool type', async () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: [],
        provider: {
          name: 'test_provider',
          provider_type: 'websocket',
          url: 'wss://example.com'
        }
      };

      await expect(transport.callTool(tool, {}))
        .rejects.toThrow('HttpClientTransport cannot handle tool with provider type: websocket');
    });
  });
});
