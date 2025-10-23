/**
 * File communication protocol for UTCP client.
 *
 * This protocol reads UTCP manuals (or OpenAPI specs) from local files to register
 * tools. It does not maintain any persistent connections.
 * For direct text content, use @utcp/text instead.
 */
// packages/file/src/file_communication_protocol.ts
import { promises as fs } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CommunicationProtocol, RegisterManualResult, CallTemplate, UtcpManual, UtcpManualSerializer, IUtcpClient } from '@utcp/sdk';
import { OpenApiConverter } from '@utcp/http';
import { FileCallTemplate, FileCallTemplateSchema } from './file_call_template';

/**
 * REQUIRED
 * Communication protocol for file-based UTCP manuals and tools.
 */
export class FileCommunicationProtocol implements CommunicationProtocol {
  private _log_info(message: string): void {
    console.log(`[FileCommunicationProtocol] ${message}`);
  }

  private _log_error(message: string): void {
    console.error(`[FileCommunicationProtocol Error] ${message}`);
  }

  /**
   * REQUIRED
   * Register a file manual and return its tools as a UtcpManual.
   */
  public async registerManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<RegisterManualResult> {
    const fileCallTemplate = FileCallTemplateSchema.parse(manualCallTemplate);

    try {
      let filePath = path.resolve(fileCallTemplate.file_path);
      if (!path.isAbsolute(fileCallTemplate.file_path) && caller.root_dir) {
        filePath = path.resolve(caller.root_dir, fileCallTemplate.file_path);
      }
      
      this._log_info(`Reading manual from '${filePath}'`);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (err: any) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const fileExt = path.extname(filePath).toLowerCase();
      let data: any;

      // Parse based on extension
      if (fileExt === '.yaml' || fileExt === '.yml') {
        data = yaml.load(content);
      } else {
        // Try JSON
        data = JSON.parse(content);
      }

      let utcpManual: UtcpManual;
      if (data && typeof data === 'object' && (data.openapi || data.swagger || data.paths)) {
        this._log_info('Detected OpenAPI specification. Converting to UTCP manual.');
        const converter = new OpenApiConverter(data, {
          specUrl: `file://${filePath}`,
          callTemplateName: fileCallTemplate.name,
          authTools: fileCallTemplate.auth_tools || undefined,
        });
        utcpManual = converter.convert();
      } else {
        // Try to validate as UTCP manual directly
        utcpManual = new UtcpManualSerializer().validateDict(data);
      }

      this._log_info(`Loaded ${utcpManual.tools.length} tools from ${filePath}`);
      return {
        manualCallTemplate,
        manual: utcpManual,
        success: true,
        errors: [],
      };
    } catch (error: any) {
      const source = fileCallTemplate.file_path || 'unknown';
      this._log_error(`Failed to parse manual from '${source}': ${error.stack || error.message}`);
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
   * Deregister a file manual (no-op).
   */
  public async deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void> {
    this._log_info(`Deregistering file manual '${manualCallTemplate.name}' (no-op)`);
  }

  /**
   * REQUIRED
   * Call a tool: for file templates, return content from the file path.
   */
  public async callTool(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): Promise<any> {
    const fileCallTemplate = FileCallTemplateSchema.parse(toolCallTemplate);

    let filePath = path.resolve(fileCallTemplate.file_path);
    if (!path.isAbsolute(fileCallTemplate.file_path) && caller.root_dir) {
      filePath = path.resolve(caller.root_dir, fileCallTemplate.file_path);
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
    this._log_info('File Communication Protocol closed (no-op).');
  }
}
