import { promises as fs } from 'fs';
import { resolve, extname } from 'path';
import { parse as parseUrl } from 'url';
import { ClientTransportInterface } from '../client-transport-interface';
import { Tool, ToolSchema } from '../../shared/tool';
import { ProviderUnion, TextProvider } from '../../shared/provider';
import { UtcpManual, UtcpManualSchema } from '../../shared/utcp-manual';
import { OpenApiConverter } from '../openapi-converter';
import { z } from 'zod';
import * as yaml from 'js-yaml';

/**
 * Transport implementation for text file-based tool providers.
 * 
 * This transport reads tool definitions from local text files. The file should
 * contain a JSON object with a 'tools' array containing tool definitions.
 * 
 * Since tools are defined statically in text files, tool calls are not supported
 * and will raise a ValueError.
 */
export class TextTransport implements ClientTransportInterface {
  private basePath: string | undefined;

  /**
   * Initialize the text transport.
   * 
   * @param basePath The base path to resolve relative file paths from.
   */
  constructor(basePath?: string) {
    this.basePath = basePath;
  }

  /**
   * Log informational messages.
   */
  private _logInfo(message: string): void {
    console.log(`[TextTransport] ${message}`);
  }

  /**
   * Log error messages.
   */
  private _logError(message: string): void {
    console.error(`[TextTransport Error] ${message}`);
  }

  /**
   * Register a text provider and discover its tools.
   * 
   * @param manual_provider The TextProvider to register
   * @returns List of tools defined in the text file
   * @throws Error if provider is not a TextProvider
   * @throws Error if the specified file doesn't exist
   * @throws Error if the file contains invalid JSON
   */
  async register_tool_provider(manual_provider: ProviderUnion): Promise<Tool[]> {
    if (manual_provider.provider_type !== 'text') {
      throw new Error('TextTransport can only be used with TextProvider');
    }

    const textProvider = manual_provider as TextProvider;
    let filePath = textProvider.file_path;
    
    // Resolve relative paths using base_path
    if (!this.isAbsolutePath(filePath) && this.basePath) {
      filePath = resolve(this.basePath, filePath);
    }

    this._logInfo(`Reading tool definitions from '${filePath}'`);

    try {
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        throw new Error(`Tool definition file not found: ${filePath}`);
      }

      // Read the file content
      const fileContent = await fs.readFile(filePath, 'utf-8');

      // Parse based on file extension
      const ext = extname(filePath).toLowerCase();
      let data: any;
      
      try {
        if (ext === '.yaml' || ext === '.yml') {
          data = yaml.load(fileContent);
        } else {
          data = JSON.parse(fileContent);
        }
      } catch (e: any) {
        this._logError(`Failed to parse file '${filePath}': ${e.message}`);
        throw new Error(`Failed to parse file '${filePath}': ${e.message}`);
      }

      // Check if the data is a UTCP manual, an OpenAPI spec, or neither
      let utcpManual: UtcpManual;
      
      if (typeof data === 'object' && data !== null && 'version' in data && 'tools' in data) {
        this._logInfo(`Detected UTCP manual in '${filePath}'.`);
        
        const manualParseResult = UtcpManualSchema.safeParse(data);
        if (!manualParseResult.success) {
          this._logError(`Invalid UTCP manual format in '${filePath}': ${JSON.stringify(manualParseResult.error)}`);
          return [];
        }
        
        utcpManual = manualParseResult.data;
      } else if (
        typeof data === 'object' && 
        data !== null && 
        ('openapi' in data || 'swagger' in data || 'paths' in data)
      ) {
        this._logInfo(`Assuming OpenAPI spec in '${filePath}'. Converting to UTCP manual.`);
        
        try {
          const fileUri = this.pathToUri(filePath);
          const converter = new OpenApiConverter(data, {
            specUrl: fileUri,
            providerName: textProvider.name
          });
          utcpManual = converter.convert();
        } catch (e: any) {
          this._logError(`Failed to convert OpenAPI spec: ${e.message}`);
          return [];
        }
      } else {
        throw new Error(`File '${filePath}' is not a valid OpenAPI specification or UTCP manual`);
      }

      this._logInfo(`Successfully loaded ${utcpManual.tools.length} tools from '${filePath}'`);
      return utcpManual.tools;

    } catch (error: any) {
      if (error.message.includes('not found')) {
        this._logError(`Tool definition file not found: ${filePath}`);
        throw error;
      }
      if (error.message.includes('Failed to parse')) {
        // Already logged in the catch block above
        throw error;
      }
      this._logError(`Unexpected error reading file '${filePath}': ${error.message}`);
      return [];
    }
  }

  /**
   * Deregister a text provider.
   * 
   * This is a no-op for text providers since they are stateless.
   * 
   * @param manual_provider The provider to deregister
   */
  async deregister_tool_provider(manual_provider: ProviderUnion): Promise<void> {
    if (manual_provider.provider_type === 'text') {
      this._logInfo(`Deregistering text provider '${manual_provider.name}' (no-op)`);
    }
  }

  /**
   * Call a tool on a text provider.
   * 
   * For text providers, this returns the content of the text file.
   * 
   * @param tool_name Name of the tool to call (ignored for text providers)
   * @param args Arguments for the tool call (ignored for text providers)
   * @param tool_provider The TextProvider containing the file
   * @returns The content of the text file as a string
   * @throws Error if provider is not a TextProvider
   * @throws Error if the specified file doesn't exist
   */
  async call_tool(
    tool_name: string,
    args: Record<string, any>,
    tool_provider: ProviderUnion
  ): Promise<any> {
    if (tool_provider.provider_type !== 'text') {
      throw new Error('TextTransport can only be used with TextProvider');
    }

    const textProvider = tool_provider as TextProvider;
    let filePath = textProvider.file_path;
    
    // Resolve relative paths using base_path
    if (this.basePath && !resolve(filePath).startsWith('/') && !filePath.includes(':')) {
      filePath = resolve(this.basePath, filePath);
    }

    this._logInfo(`Reading content from '${filePath}' for tool '${tool_name}'`);

    try {
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        throw new Error(`File not found: ${filePath}`);
      }

      // Read and return the file content
      const content = await fs.readFile(filePath, 'utf-8');
      this._logInfo(`Successfully read ${content.length} characters from '${filePath}'`);
      return content;

    } catch (error: any) {
      if (error.message.includes('not found')) {
        this._logError(`File not found: ${filePath}`);
        throw error;
      }
      this._logError(`Error reading file '${filePath}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Close the transport.
   * 
   * This is a no-op for text transports since they don't maintain connections.
   */
  async close(): Promise<void> {
    this._logInfo("Closing text transport (no-op)");
  }
  
  /**
   * Check if a path is absolute.
   * @param path The path to check
   * @returns True if the path is absolute, false otherwise
   */
  private isAbsolutePath(path: string): boolean {
    return resolve(path) === path;
  }
  
  /**
   * Convert a file path to a URI.
   * @param path The file path
   * @returns The file URI
   */
  private pathToUri(path: string): string {
    // Convert to URL format with file:// protocol
    const normalized = path.replace(/\\/g, '/');
    return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
  }
}
