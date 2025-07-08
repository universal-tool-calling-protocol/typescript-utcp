import { UtcpClient } from '../../src/client/utcp-client';
import { HttpProvider } from '../../src/shared/provider';
import { Tool } from '../../src/shared/tool';
import axios, { AxiosError } from 'axios';

// Mock axios for HTTP transport tests
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock fs for file loading tests
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue('[]')
}));

const fs = require('fs/promises');
const mockReadFile = fs.readFile;

// Mock axios.create to return a mocked instance
const mockAxiosInstance = {
  request: jest.fn(),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  patch: jest.fn(),
};

mockedAxios.create = jest.fn(() => mockAxiosInstance as any);
mockedAxios.isAxiosError = ((payload: any): payload is AxiosError => false) as any;

describe('UtcpClient', () => {
  let client: UtcpClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock axios instance to return empty manual (no tools)
    mockAxiosInstance.request.mockResolvedValue({ data: { tools: [] } });
    
    client = new UtcpClient({
      tool_repository_type: 'in_memory',
      search_strategy: 'tag',
      max_concurrent_calls: 5,
      default_timeout: 30000,
      retry_attempts: 3,
      retry_delay: 1000,
      providers: []
    });
  });

  afterEach(async () => {
    await client.cleanup();
  });

  describe('constructor', () => {
    it('should create client with default config', () => {
      expect(client).toBeInstanceOf(UtcpClient);
    });

    it('should validate config', () => {
      expect(() => new UtcpClient({
        max_concurrent_calls: -1
      } as any)).toThrow();
    });
  });

  describe('registerToolProvider', () => {
    it('should register a provider', async () => {
      const provider: HttpProvider = {
        name: 'test_provider',
        provider_type: 'http',
        url: 'https://example.com',
        http_method: 'GET',
        content_type: 'application/json',
        body_field: 'body'
      };

      const tools = await client.registerToolProvider(provider);
      expect(Array.isArray(tools)).toBe(true);
    });

    it('should reject duplicate provider names', async () => {
      const provider: HttpProvider = {
        name: 'test_provider',
        provider_type: 'http',
        url: 'https://example.com',
        http_method: 'GET',
        content_type: 'application/json',
        body_field: 'body'
      };

      await client.registerToolProvider(provider);
      
      await expect(client.registerToolProvider(provider))
        .rejects.toThrow('Provider test_provider is already registered');
    });
  });

  describe('deregisterToolProvider', () => {
    it('should deregister a provider', async () => {
      const provider: HttpProvider = {
        name: 'test_provider',
        provider_type: 'http',
        url: 'https://example.com',
        http_method: 'GET',
        content_type: 'application/json',
        body_field: 'body'
      };

      await client.registerToolProvider(provider);
      client.deregisterToolProvider('test_provider');
      
      // Should not throw when deregistering again
      expect(() => client.deregisterToolProvider('non_existent'))
        .toThrow('Provider non_existent is not registered');
    });
  });

  describe('callTool', () => {
    it('should throw error for non-existent tool', async () => {
      await expect(client.callTool('non_existent_tool', {}))
        .rejects.toThrow('Tool non_existent_tool not found');
    });
  });

  describe('getAvailableTools', () => {
    it('should return empty array initially', () => {
      const tools = client.getAvailableTools();
      expect(tools).toEqual([]);
    });
  });

  describe('searchTools', () => {
    it('should return empty array for no matches', () => {
      const results = client.searchTools('nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('getToolsByTag', () => {
    it('should return empty array for no matches', () => {
      const results = client.getToolsByTag('nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('create', () => {
    it('should create client with providers_file_path', async () => {
      // Reset the mock to return empty array
      mockReadFile.mockResolvedValue('[]');

      const client = await UtcpClient.create({
        tool_repository_type: 'in_memory',
        search_strategy: 'tag',
        max_concurrent_calls: 5,
        default_timeout: 30000,
        retry_attempts: 3,
        retry_delay: 1000,
        providers_file_path: './test-providers.json'
      });

      expect(client).toBeInstanceOf(UtcpClient);
      await client.cleanup();
    });
  });
});
