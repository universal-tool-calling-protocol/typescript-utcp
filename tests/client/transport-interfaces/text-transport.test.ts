import path from 'path';
import { TextTransport } from '../../../src/client/transport-interfaces/text-transport';
import { TextProvider } from '../../../src/shared/provider';

describe('TextTransport', () => {
  let transport: TextTransport;

  beforeEach(() => {
    transport = new TextTransport();
  });

  const createProvider = (filePath: string): TextProvider => ({
    provider_type: 'text',
    name: 'test-text-provider',
    file_path: path.resolve(__dirname, filePath),
    auth: null,
  });

  describe('register_tool_provider', () => {
    it('should load tools from a UTCP manual format', async () => {
      const provider = createProvider('manual.test.json');
      const tools = await transport.register_tool_provider(provider);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('tool1');
    });

    it('should load a single tool from a file', async () => {
      const provider = createProvider('single-tool.test.json');
      const tools = await transport.register_tool_provider(provider);
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('single_tool');
    });

    it('should load an array of tools from a file', async () => {
      const provider = createProvider('tool-array.test.json');
      const tools = await transport.register_tool_provider(provider);
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toEqual(['tool_a', 'tool_b']);
    });

    it('should throw an error for a non-existent file', async () => {
      const provider = createProvider('not-found.json');
      await expect(transport.register_tool_provider(provider)).rejects.toThrow(/Tool definition file not found/);
    });

    it('should throw an error for invalid JSON', async () => {
      // Create an invalid JSON file for this test
      const fs = require('fs');
      const invalidJsonPath = path.resolve(__dirname, 'invalid.json');
      fs.writeFileSync(invalidJsonPath, '{ invalid json }');
      const provider = createProvider('invalid.json');
      await expect(transport.register_tool_provider(provider)).rejects.toThrow(/Invalid JSON in file/);
      fs.unlinkSync(invalidJsonPath); // Clean up
    });

    it('should return an empty array for an unrecognized format', async () => {
      const provider = createProvider('invalid-format.test.json');
      const tools = await transport.register_tool_provider(provider);
      expect(tools).toEqual([]);
    });
  });

  describe('call_tool', () => {
    it('should return the raw content of the file', async () => {
      const provider = createProvider('raw.test.txt');
      const result = await transport.call_tool('any_tool', {}, provider);
      expect(result.trim()).toBe('This is the raw file content.');
    });

    it('should throw an error if the file is not found', async () => {
      const provider = createProvider('not-found.txt');
      await expect(transport.call_tool('any_tool', {}, provider)).rejects.toThrow(/File not found/);
    });
  });

  describe('deregister_tool_provider', () => {
    it('should be a no-op and not throw', async () => {
      const provider = createProvider('raw.test.txt');
      await expect(transport.deregister_tool_provider(provider)).resolves.not.toThrow();
    });
  });
});
