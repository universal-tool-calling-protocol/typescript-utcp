import { promises as fs } from 'fs';
import { ClientTransportInterface } from '../client-transport-interface';
import { Tool, ToolSchema } from '../../shared/tool';
import { ProviderUnion, TextProvider } from '../../shared/provider';
import { UtcpManualSchema } from '../../shared/utcp-manual';
import { z } from 'zod';

/**
 * Transport for text file-based tool providers.
 * 
 * This transport reads tool definitions from local JSON files.
 * Tool calls are not supported in the traditional sense; instead, `call_tool`
 * returns the raw content of the file associated with the provider.
 */
export class TextTransport implements ClientTransportInterface {
  private _logger: (message: string, error?: boolean) => void;

  /**
   * Initialize the text transport.
   * @param logger Optional logger function for debugging.
   */
  constructor(logger?: (message: string, error?: boolean) => void) {
    this._logger = logger || ((message: string, error?: boolean) => {});
  }

  /**
   * Register a text provider and discover its tools from a file.
   * @param provider The TextProvider to register.
   * @returns A list of tools defined in the text file.
   */
  async register_tool_provider(provider: ProviderUnion): Promise<Tool[]> {
    if (provider.provider_type !== 'text') {
      throw new Error('TextTransport can only be used with TextProvider');
    }

    const { file_path } = provider as TextProvider;
    this._logger(`Reading tool definitions from '${file_path}'`);

    try {
      const fileContent = await fs.readFile(file_path, 'utf-8');
      const data = JSON.parse(fileContent);

      // The order of checks is important: manual -> array -> single tool.
      const manualParseResult = UtcpManualSchema.safeParse(data);
      if (manualParseResult.success) {
        this._logger(`Detected UTCP manual in '${file_path}'`);
        return manualParseResult.data.tools;
      }

      const toolArrayParseResult = z.array(ToolSchema).safeParse(data);
      if (toolArrayParseResult.success) {
        this._logger(`Detected array of tools in '${file_path}'`);
        return toolArrayParseResult.data;
      }

      const singleToolParseResult = ToolSchema.safeParse(data);
      if (singleToolParseResult.success) {
        this._logger(`Detected a single tool in '${file_path}'`);
        return [singleToolParseResult.data];
      }

      // If none of the formats match, return an empty array.
      const errorMessage = `Invalid or unrecognized file format in '${file_path}'.`;
      this._logger(errorMessage, true);
      return [];


    } catch (error: any) {
      if (error.code === 'ENOENT') {
        const errorMessage = `Tool definition file not found: ${file_path}`;
        this._logger(errorMessage, true);
        throw new Error(errorMessage);
      }
      if (error instanceof SyntaxError) {
        const errorMessage = `Invalid JSON in file '${file_path}': ${error.message}`;
        this._logger(errorMessage, true);
        throw new Error(errorMessage);
      }
      this._logger(`Unexpected error reading file '${file_path}': ${error.message}`, true);
      throw error;
    }
  }

  /**
   * Deregister a text provider (no-op for this transport).
   * @param provider The provider to deregister.
   */
  async deregister_tool_provider(provider: ProviderUnion): Promise<void> {
    if (provider.provider_type === 'text') {
      this._logger(`Deregistering text provider '${provider.name}' (no-op)`);
    }
  }

  /**
   * "Calls" a tool on a text provider by returning the file's content.
   * @param tool_name Ignored for this transport.
   * @param args Ignored for this transport.
   * @param provider The TextProvider containing the file.
   * @returns The raw content of the text file as a string.
   */
  async call_tool(
    tool_name: string,
    args: Record<string, any>,
    provider: ProviderUnion
  ): Promise<any> {
    if (provider.provider_type !== 'text') {
      throw new Error('TextTransport can only be used with TextProvider');
    }

    const { file_path } = provider as TextProvider;
    this._logger(`Reading content from '${file_path}' for tool call '${tool_name}'`);

    try {
      const content = await fs.readFile(file_path, 'utf-8');
      this._logger(`Successfully read ${content.length} characters from '${file_path}'`);
      return content;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        const errorMessage = `File not found: ${file_path}`;
        this._logger(errorMessage, true);
        throw new Error(errorMessage);
      }
      const errorMessage = `Error reading file '${file_path}': ${error.message}`;
      this._logger(errorMessage, true);
      throw new Error(errorMessage);
    }
  }
}
