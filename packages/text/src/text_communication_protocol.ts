/**
 * Text communication protocol for UTCP client.
 *
 * This protocol reads UTCP manuals (or OpenAPI specs) from local files to register
 * tools. It does not maintain any persistent connections.
 */
// packages/text/src/text_communication_protocol.ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CommunicationProtocol, RegisterManualResult, CallTemplate, UtcpManual, UtcpManualSerializer, IUtcpClient } from '@utcp/sdk';
import { OpenApiConverter } from '@utcp/http';
import { TextCallTemplate, TextCallTemplateSchema } from './text_call_template';

/**
 * REQUIRED
 * Communication protocol for file-based UTCP manuals and tools.
 */
export class TextCommunicationProtocol implements CommunicationProtocol {
  private _log_info(message: string): void {
    console.log(`[TextCommunicationProtocol] ${message}`);
  }

  private _log_error(message: string): void {
    console.error(`[TextCommunicationProtocol Error] ${message}`);
  }

  /**
   * REQUIRED
   * Register a text manual and return its tools as a UtcpManual.
   */
  public async registerManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<RegisterManualResult> {
    if (!(manualCallTemplate as any).file_path) {
      throw new Error('TextCommunicationProtocol requires a TextCallTemplate');
    }

    const textCallTemplate = TextCallTemplateSchema.parse(manualCallTemplate);
    let filePath = path.resolve(textCallTemplate.file_path);
    if (!path.isAbsolute(textCallTemplate.file_path) && caller.root_dir) {
      filePath = path.resolve(caller.root_dir, textCallTemplate.file_path);
    }

    this._log_info(`Reading manual from '${filePath}'`);

    try {
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (err: any) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      }

      const fileContent = await fs.readFile(filePath, 'utf-8');
      const fileExt = path.extname(filePath).toLowerCase();
      let data: any;

      // Parse based on extension
      if (fileExt === '.yaml' || fileExt === '.yml') {
        data = yaml.load(fileContent);
      } else {
        data = JSON.parse(fileContent);
      }

      let utcpManual: UtcpManual;
      if (data && typeof data === 'object' && (data.openapi || data.swagger || data.paths)) {
        this._log_info('Detected OpenAPI specification. Converting to UTCP manual.');
        const converter = new OpenApiConverter(data, {
          specUrl: `file://${filePath}`,
          callTemplateName: textCallTemplate.name,
          authTools: textCallTemplate.auth_tools || undefined,
        });
        utcpManual = converter.convert();
      } else {
        // Try to validate as UTCP manual directly
        utcpManual = new UtcpManualSerializer().validateDict(data);
      }

      this._log_info(`Loaded ${utcpManual.tools.length} tools from '${filePath}'`);
      return {
        manualCallTemplate,
        manual: utcpManual,
        success: true,
        errors: [],
      };
    } catch (error: any) {
      this._log_error(`Failed to parse manual '${filePath}': ${error.stack || error.message}`);
      return {
        manualCallTemplate,
        manual: new UtcpManualSerializer().validateDict({ tools: [] }),
        success: false,
        errors: [error.stack || error.message],
      };
    }
  }

  /**
   * REQUIRED
   * Deregister a text manual (no-op).
   */
  public async deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void> {
    this._log_info(`Deregistering text manual '${manualCallTemplate.name}' (no-op)`);
  }

  /**
   * REQUIRED
   * Call a tool: for text templates, return file content from the configured path.
   */
  public async callTool(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): Promise<any> {
    if (!(toolCallTemplate as any).file_path) {
      throw new Error('TextCommunicationProtocol requires a TextCallTemplate for tool calls');
    }

    const textCallTemplate = TextCallTemplateSchema.parse(toolCallTemplate);
    let filePath = path.resolve(textCallTemplate.file_path);
    if (!path.isAbsolute(textCallTemplate.file_path) && caller.root_dir) {
      filePath = path.resolve(caller.root_dir, textCallTemplate.file_path);
    }

    this._log_info(`Reading content from '${filePath}' for tool '${toolName}'`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this._log_error(`File not found for tool '${toolName}': ${filePath}`);
      }
      throw error;
    }
  }

  /**
   * REQUIRED
   * Streaming variant: yields the full content as a single chunk.
   */
  public async *callToolStreaming(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): AsyncGenerator<any, void, unknown> {
    const result = await this.callTool(caller, toolName, toolArgs, toolCallTemplate);
    yield result;
  }

  public async close(): Promise<void> {
    this._log_info('Text Communication Protocol closed (no-op).');
  }
}