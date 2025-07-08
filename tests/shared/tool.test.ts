import { Tool, ToolContext, createUtcpTool, ToolSchema } from '../../src/shared/tool';
import { HttpProvider } from '../../src/shared/provider';

describe('Tool', () => {
  beforeEach(() => {
    ToolContext.clearTools();
  });

  describe('ToolSchema', () => {
    it('should validate a valid tool', () => {
      const validTool = {
        name: 'test_tool',
        description: 'A test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: ['test'],
        provider: {
          name: 'test_provider',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'GET',
          content_type: 'application/json',
          body_field: 'body'
        }
      };

      const result = ToolSchema.safeParse(validTool);
      expect(result.success).toBe(true);
    });

    it('should reject tool with missing required fields', () => {
      const invalidTool = {
        description: 'A test tool',
      };

      const result = ToolSchema.safeParse(invalidTool);
      expect(result.success).toBe(false);
    });
  });

  describe('ToolContext', () => {
    it('should add and retrieve tools', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: ['test'],
        provider: {
          name: 'test_provider',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'GET',
          content_type: 'application/json',
          body_field: 'body'
        }
      };

      ToolContext.addTool(tool);
      const tools = ToolContext.getTools();
      
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe('test_tool');
    });

    it('should find tool by name', () => {
      const tool: Tool = {
        name: 'test_tool',
        description: 'A test tool',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: ['test'],
        provider: {
          name: 'test_provider',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'GET',
          content_type: 'application/json',
          body_field: 'body'
        }
      };

      ToolContext.addTool(tool);
      const foundTool = ToolContext.findTool('test_tool');
      
      expect(foundTool).toBeDefined();
      expect(foundTool!.name).toBe('test_tool');
    });

    it('should remove tools by provider', () => {
      const tool1: Tool = {
        name: 'tool1',
        description: 'Tool 1',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: ['test'],
        provider: {
          name: 'provider1',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'GET',
          content_type: 'application/json',
          body_field: 'body'
        }
      };

      const tool2: Tool = {
        name: 'tool2',
        description: 'Tool 2',
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: {} },
        tags: ['test'],
        provider: {
          name: 'provider2',
          provider_type: 'http',
          url: 'https://example.com',
          http_method: 'GET',
          content_type: 'application/json',
          body_field: 'body'
        }
      };

      ToolContext.addTool(tool1);
      ToolContext.addTool(tool2);
      
      expect(ToolContext.getTools()).toHaveLength(2);
      
      ToolContext.removeToolsByProvider('provider1');
      const remainingTools = ToolContext.getTools();
      
      expect(remainingTools).toHaveLength(1);
      expect(remainingTools[0]!.name).toBe('tool2');
    });
  });

  describe('createUtcpTool', () => {
    it('should create tool with default values', () => {
      const provider: HttpProvider = {
        name: 'test_provider',
        provider_type: 'http',
        url: 'https://example.com',
        http_method: 'GET',
        content_type: 'application/json',
        body_field: 'body'
      };

      const testFunction = function testFunc() { return 'test'; };
      const tool = createUtcpTool(provider, {}, testFunction);

      expect(tool.name).toBe('testFunc');
      expect(tool.description).toBe('');
      expect(tool.tags).toEqual(['utcp']);
      expect(tool.provider.name).toBe('test_provider');
    });

    it('should create tool with custom options', () => {
      const provider: HttpProvider = {
        name: '',
        provider_type: 'http',
        url: 'https://example.com',
        http_method: 'GET',
        content_type: 'application/json',
        body_field: 'body'
      };

      const testFunction = function testFunc() { return 'test'; };
      const tool = createUtcpTool(provider, {
        name: 'custom_tool',
        description: 'Custom description',
        tags: ['custom', 'test']
      }, testFunction);

      expect(tool.name).toBe('custom_tool');
      expect(tool.description).toBe('Custom description');
      expect(tool.tags).toEqual(['custom', 'test']);
      expect(tool.provider.name).toBe('custom_tool_provider');
    });
  });
});
