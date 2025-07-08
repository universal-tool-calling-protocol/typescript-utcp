import { 
  ProviderUnionSchema, 
  HttpProviderSchema, 
  WebSocketProviderSchema,
  CliProviderSchema 
} from '../../src/shared/provider';

describe('Provider', () => {
  describe('HttpProviderSchema', () => {
    it('should validate a valid HTTP provider', () => {
      const validProvider = {
        name: 'test_provider',
        provider_type: 'http',
        url: 'https://example.com',
        http_method: 'GET'
      };

      const result = HttpProviderSchema.safeParse(validProvider);
      expect(result.success).toBe(true);
    });

    it('should apply default values', () => {
      const provider = {
        name: 'test_provider',
        provider_type: 'http',
        url: 'https://example.com'
      };

      const result = HttpProviderSchema.parse(provider);
      expect(result.http_method).toBe('GET');
      expect(result.content_type).toBe('application/json');
      expect(result.body_field).toBe('body');
    });

    it('should reject invalid HTTP method', () => {
      const invalidProvider = {
        name: 'test_provider',
        provider_type: 'http',
        url: 'https://example.com',
        http_method: 'INVALID'
      };

      const result = HttpProviderSchema.safeParse(invalidProvider);
      expect(result.success).toBe(false);
    });
  });

  describe('WebSocketProviderSchema', () => {
    it('should validate a valid WebSocket provider', () => {
      const validProvider = {
        name: 'ws_provider',
        provider_type: 'websocket',
        url: 'wss://example.com/ws'
      };

      const result = WebSocketProviderSchema.safeParse(validProvider);
      expect(result.success).toBe(true);
    });

    it('should handle optional fields', () => {
      const provider = {
        name: 'ws_provider',
        provider_type: 'websocket',
        url: 'wss://example.com/ws',
        subprotocols: ['utcp'],
        ping_interval: 30000
      };

      const result = WebSocketProviderSchema.parse(provider);
      expect(result.subprotocols).toEqual(['utcp']);
      expect(result.ping_interval).toBe(30000);
    });
  });

  describe('CliProviderSchema', () => {
    it('should validate a valid CLI provider', () => {
      const validProvider = {
        name: 'cli_provider',
        provider_type: 'cli',
        command: 'node'
      };

      const result = CliProviderSchema.safeParse(validProvider);
      expect(result.success).toBe(true);
    });

    it('should handle optional fields', () => {
      const provider = {
        name: 'cli_provider',
        provider_type: 'cli',
        command: 'node',
        args: ['--version'],
        env: { NODE_ENV: 'test' },
        cwd: '/tmp',
        timeout: 5000
      };

      const result = CliProviderSchema.parse(provider);
      expect(result.args).toEqual(['--version']);
      expect(result.env).toEqual({ NODE_ENV: 'test' });
      expect(result.cwd).toBe('/tmp');
      expect(result.timeout).toBe(5000);
    });
  });

  describe('ProviderUnionSchema', () => {
    it('should discriminate between provider types', () => {
      const httpProvider = {
        name: 'http_provider',
        provider_type: 'http',
        url: 'https://example.com'
      };

      const wsProvider = {
        name: 'ws_provider',
        provider_type: 'websocket',
        url: 'wss://example.com/ws'
      };

      const httpResult = ProviderUnionSchema.parse(httpProvider);
      const wsResult = ProviderUnionSchema.parse(wsProvider);

      expect(httpResult.provider_type).toBe('http');
      expect(wsResult.provider_type).toBe('websocket');
    });

    it('should reject invalid provider type', () => {
      const invalidProvider = {
        name: 'invalid_provider',
        provider_type: 'invalid',
        url: 'https://example.com'
      };

      const result = ProviderUnionSchema.safeParse(invalidProvider);
      expect(result.success).toBe(false);
    });
  });
});
