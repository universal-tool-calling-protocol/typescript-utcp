import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { TextTransport } from '../../../src/client/transport-interfaces/text-transport';
import { TextProvider } from '../../../src/shared/provider';
import { HttpProvider } from '../../../src/shared/provider';
import { Tool } from '../../../src/shared/tool';

describe('TextTransport', () => {
  let transport: TextTransport;
  let tempDir: string;
  
  beforeEach(async () => {
    transport = new TextTransport();
    // Create a temporary directory for test files
    tempDir = path.join(os.tmpdir(), `utcp-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await transport.close();
    try {
      // Clean up temporary directory
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors in cleanup
    }
  });

  const createProvider = (filePath: string): TextProvider => ({
    provider_type: 'text',
    name: 'test-text-provider',
    file_path: filePath,
    auth: null,
  });

  // Test fixtures
  const sampleUtcpManual = {
    "version": "1.0.0",
    "name": "Sample Tools",
    "description": "A collection of sample tools for testing",
    "tools": [
      {
        "name": "calculator",
        "description": "Performs basic arithmetic operations",
        "inputs": {
          "properties": {
            "operation": {
              "type": "string",
              "enum": ["add", "subtract", "multiply", "divide"]
            },
            "a": {"type": "number"},
            "b": {"type": "number"}
          },
          "required": ["operation", "a", "b"]
        },
        "outputs": {
          "properties": {
            "result": {"type": "number"}
          }
        },
        "tags": ["math", "arithmetic"],
        "tool_provider": {
          "provider_type": "text",
          "name": "test-text-provider",
          "file_path": "dummy.json"
        }
      },
      {
        "name": "string_utils",
        "description": "String manipulation utilities",
        "inputs": {
          "properties": {
            "text": {"type": "string"},
            "operation": {
              "type": "string",
              "enum": ["uppercase", "lowercase", "reverse"]
            }
          },
          "required": ["text", "operation"]
        },
        "outputs": {
          "properties": {
            "result": {"type": "string"}
          }
        },
        "tags": ["text", "utilities"],
        "tool_provider": {
          "provider_type": "text",
          "name": "test-text-provider",
          "file_path": "dummy.json"
        }
      }
    ]
  };

  const singleToolDefinition = {
    "name": "echo",
    "description": "Echoes back the input text",
    "inputs": {
      "properties": {
        "message": {"type": "string"}
      },
      "required": ["message"]
    },
    "outputs": {
      "properties": {
        "echo": {"type": "string"}
      }
    },
    "tags": ["utility"],
    "tool_provider": {
      "provider_type": "text",
      "name": "test-text-provider",
      "file_path": "dummy.json"
    }
  };

  const toolArray = [
    {
      "name": "tool1",
      "description": "First tool",
      "inputs": {"properties": {}, "required": []},
      "outputs": {"properties": {}, "required": []},
      "tags": [],
      "tool_provider": {
        "provider_type": "text",
        "name": "test-text-provider",
        "file_path": "dummy.json"
      }
    },
    {
      "name": "tool2",
      "description": "Second tool",
      "inputs": {"properties": {}, "required": []},
      "outputs": {"properties": {}, "required": []},
      "tags": [],
      "tool_provider": {
        "provider_type": "text",
        "name": "test-text-provider",
        "file_path": "dummy.json"
      }
    }
  ];

  describe('register_tool_provider', () => {
    it('should load tools from a UTCP manual format (JSON)', async () => {
      // Create a temporary file with the UTCP manual content
      const tempFile = path.join(tempDir, 'utcp-manual.json');
      await fs.writeFile(tempFile, JSON.stringify(sampleUtcpManual));
      
      const provider = createProvider(tempFile);
      const tools = await transport.register_tool_provider(provider);
      
      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe('calculator');
      expect(tools[0]?.description).toBe('Performs basic arithmetic operations');
      expect(tools[0]?.tags).toEqual(['math', 'arithmetic']);
      expect(tools[0]?.tool_provider?.name).toBe('test-text-provider');
      
      expect(tools[1]?.name).toBe('string_utils');
      expect(tools[1]?.description).toBe('String manipulation utilities');
      expect(tools[1]?.tags).toEqual(['text', 'utilities']);
      expect(tools[1]?.tool_provider?.name).toBe('test-text-provider');
    });
    
    it('should load tools from a UTCP manual format (YAML)', async () => {
      // Create a temporary file with the UTCP manual content in YAML
      const tempFile = path.join(tempDir, 'utcp-manual.yaml');
      // Simple YAML representation
      const yamlContent = `
version: 1.0.0
name: Sample Tools
description: A collection of sample tools for testing
tools:
  - name: calculator
    description: Performs basic arithmetic operations
    inputs:
      properties:
        operation:
          type: string
          enum: [add, subtract, multiply, divide]
        a:
          type: number
        b:
          type: number
      required: [operation, a, b]
    outputs:
      properties:
        result:
          type: number
    tags: [math, arithmetic]
    tool_provider:
      provider_type: text
      name: test-text-provider
      file_path: dummy.json
`;
      await fs.writeFile(tempFile, yamlContent);
      
      const provider = createProvider(tempFile);
      const tools = await transport.register_tool_provider(provider);
      
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('calculator');
      expect(tools[0]?.description).toBe('Performs basic arithmetic operations');
      expect(tools[0]?.tags).toEqual(['math', 'arithmetic']);
    });

    it('should load a single tool when wrapped in a UTCP manual', async () => {
      const tempFile = path.join(tempDir, 'single-tool-manual.json');
      const manual = {
        "version": "1.0.0",
        "name": "Single Tool Manual",
        "description": "A manual with a single tool",
        "tools": [singleToolDefinition]
      };
      
      await fs.writeFile(tempFile, JSON.stringify(manual));
      
      const provider = createProvider(tempFile);
      const tools = await transport.register_tool_provider(provider);
      
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('echo');
      expect(tools[0]?.description).toBe('Echoes back the input text');
      expect(tools[0]?.tags).toEqual(['utility']);
      expect(tools[0]?.tool_provider?.name).toBe('test-text-provider');
    });

    it('should load tools when the manual contains a tool array', async () => {
      const tempFile = path.join(tempDir, 'tool-array-manual.json');
      const manual = {
        "version": "1.0.0",
        "name": "Tool Array Manual",
        "description": "A manual with a tool array",
        "tools": toolArray
      };
      
      await fs.writeFile(tempFile, JSON.stringify(manual));
      
      const provider = createProvider(tempFile);
      const tools = await transport.register_tool_provider(provider);
      
      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe('tool1');
      expect(tools[1]?.name).toBe('tool2');
      expect(tools[0]?.tool_provider?.name).toBe('test-text-provider');
      expect(tools[1]?.tool_provider?.name).toBe('test-text-provider');
    });
    
    it('should handle OpenAPI specification', async () => {
      const tempFile = path.join(tempDir, 'openapi-spec.json');
      // Simple OpenAPI spec for testing
      const openApiSpec = {
        "openapi": "3.0.0",
        "info": {
          "title": "Test API",
          "version": "1.0.0"
        },
        "paths": {
          "/pets": {
            "get": {
              "operationId": "listPets",
              "summary": "List all pets",
              "tags": ["pets"],
              "parameters": [],
              "responses": {
                "200": {
                  "description": "A list of pets",
                  "content": {
                    "application/json": {
                      "schema": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "id": { "type": "integer" },
                            "name": { "type": "string" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };
      
      await fs.writeFile(tempFile, JSON.stringify(openApiSpec));
      
      const provider = createProvider(tempFile);
      const tools = await transport.register_tool_provider(provider);
      
      // Expect at least one tool converted from the OpenAPI spec
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]?.name).toBe('listPets');
    });

    it('should throw an error for a non-existent file', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent-file.json');
      const provider = createProvider(nonExistentPath);
      await expect(transport.register_tool_provider(provider)).rejects.toThrow(/Tool definition file not found/);
    });

    it('should throw an error for invalid JSON', async () => {
      const invalidJsonPath = path.join(tempDir, 'invalid.json');
      await fs.writeFile(invalidJsonPath, '{ invalid json }');
      
      const provider = createProvider(invalidJsonPath);
      await expect(transport.register_tool_provider(provider)).rejects.toThrow(/Failed to parse file/);
    });
    
    it('should throw an error for invalid YAML', async () => {
      const invalidYamlPath = path.join(tempDir, 'invalid.yaml');
      await fs.writeFile(invalidYamlPath, 'invalid: yaml: content: : : :\n - not valid');
      
      const provider = createProvider(invalidYamlPath);
      await expect(transport.register_tool_provider(provider)).rejects.toThrow(/Failed to parse file/);
    });
    
    it('should throw an error when using wrong provider type', async () => {
      const httpProvider = {
        provider_type: 'http',
        name: 'http_provider',
        url: 'https://example.com',
        http_method: 'GET'
      } as HttpProvider;
      
      await expect(transport.register_tool_provider(httpProvider)).rejects.toThrow(/TextTransport can only be used with TextProvider/);
    });
  });

  describe('call_tool', () => {
    it('should return the raw content of the file', async () => {
      // Create a test file
      const tempFile = path.join(tempDir, 'raw-content.txt');
      const fileContent = 'This is the raw file content for testing.';
      await fs.writeFile(tempFile, fileContent);
      
      const provider = createProvider(tempFile);
      const result = await transport.call_tool('any_tool', {}, provider);
      
      expect(result).toBe(fileContent);
    });
    
    it('should return the raw JSON content of a file', async () => {
      const tempFile = path.join(tempDir, 'sample-utcp-manual.json');
      await fs.writeFile(tempFile, JSON.stringify(sampleUtcpManual));
      
      const provider = createProvider(tempFile);
      // Register the provider first
      await transport.register_tool_provider(provider);
      
      // Call a tool should return the file content
      const content = await transport.call_tool('calculator', {operation: 'add', a: 1, b: 2}, provider);
      
      // Verify we get the JSON content back as a string
      expect(typeof content).toBe('string');
      // Parse it back to verify it's the same content
      const parsedContent = JSON.parse(content);
      expect(parsedContent).toEqual(sampleUtcpManual);
    });
    
    it('should throw an error if the file is not found', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent-file.txt');
      const provider = createProvider(nonExistentPath);
      await expect(transport.call_tool('any_tool', {}, provider)).rejects.toThrow(/File not found/);
    });
    
    it('should throw an error when using wrong provider type', async () => {
      const httpProvider = {
        provider_type: 'http',
        name: 'http_provider',
        url: 'https://example.com',
        http_method: 'GET'
      } as HttpProvider;
      
      await expect(transport.call_tool('some_tool', {}, httpProvider)).rejects.toThrow(/TextTransport can only be used with TextProvider/);
    });
  });

  describe('deregister_tool_provider', () => {
    it('should be a no-op and not throw for a text provider', async () => {
      const tempFile = path.join(tempDir, 'sample.json');
      await fs.writeFile(tempFile, JSON.stringify(sampleUtcpManual));
      
      const provider = createProvider(tempFile);
      
      // Register and then deregister
      await transport.register_tool_provider(provider);
      await expect(transport.deregister_tool_provider(provider)).resolves.not.toThrow();
    });
    
    it('should be a no-op for non-text providers', async () => {
      const httpProvider = {
        provider_type: 'http',
        name: 'http_provider',
        url: 'https://example.com',
        http_method: 'GET'
      } as HttpProvider;
      
      await expect(transport.deregister_tool_provider(httpProvider)).resolves.not.toThrow();
    });
  });
  
  describe('close', () => {
    it('should close the transport without errors', async () => {
      await expect(transport.close()).resolves.not.toThrow();
    });
  });
});
