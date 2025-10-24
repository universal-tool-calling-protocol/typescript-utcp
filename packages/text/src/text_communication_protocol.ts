/**
 * Text communication protocol for UTCP client.
 *
 * This protocol parses UTCP manuals (or OpenAPI specs) from direct text content.
 * It's browser-compatible and requires no file system access.
 */
// packages/text/src/text_communication_protocol.ts
import * as yaml from 'js-yaml';
import { CommunicationProtocol, RegisterManualResult, CallTemplate, UtcpManual, UtcpManualSerializer, IUtcpClient } from '@utcp/sdk';
import { OpenApiConverter } from '@utcp/http';
import { TextCallTemplate, TextCallTemplateSchema } from './text_call_template';

/**
 * REQUIRED
 * Communication protocol for text-based UTCP manuals and tools.
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
    const textCallTemplate = TextCallTemplateSchema.parse(manualCallTemplate);

    try {
      this._log_info('Parsing direct content for manual');
      const content = textCallTemplate.content;
      let data: any;

      // Try JSON first, then YAML
      try {
        data = JSON.parse(content);
      } catch (jsonError) {
        try {
          data = yaml.load(content);
        } catch (yamlError) {
          throw new Error(`Failed to parse content as JSON or YAML: ${(jsonError as Error).message}`);
        }
      }

      let utcpManual: UtcpManual;
      if (data && typeof data === 'object' && (data.openapi || data.swagger || data.paths)) {
        this._log_info('Detected OpenAPI specification. Converting to UTCP manual.');
        const converter = new OpenApiConverter(data, {
          specUrl: 'text://content',
          callTemplateName: textCallTemplate.name,
          authTools: textCallTemplate.auth_tools || undefined,
          baseUrl: textCallTemplate.base_url,
        });
        utcpManual = converter.convert();
      } else {
        // Try to validate as UTCP manual directly
        this._log_info('Validating content as UTCP manual.');
        utcpManual = new UtcpManualSerializer().validateDict(data);
      }

      this._log_info(`Successfully registered manual with ${utcpManual.tools.length} tools.`);
      return {
        manualCallTemplate: textCallTemplate,
        manual: utcpManual,
        success: true,
        errors: [],
      };
    } catch (err: any) {
      const errMsg = `Failed to register text manual: ${err.message}`;
      this._log_error(errMsg);
      return {
        manualCallTemplate: textCallTemplate,
        manual: new UtcpManualSerializer().validateDict({ tools: [] }),
        success: false,
        errors: [errMsg],
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
   * Execute a tool call. Text protocol returns the content directly.
   */
  public async callTool(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): Promise<any> {
    const textCallTemplate = TextCallTemplateSchema.parse(toolCallTemplate);
    this._log_info(`Returning direct content for tool '${toolName}'`);
    return textCallTemplate.content;
  }

  /**
   * REQUIRED
   * Streaming variant: yields the full content as a single chunk.
   */
  public async *callToolStreaming(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): AsyncGenerator<any, void, unknown> {
    const result = await this.callTool(caller, toolName, toolArgs, toolCallTemplate);
    yield result;
  }

  /**
   * REQUIRED
   * Close the protocol connection (no-op for text protocol).
   */
  public async close(): Promise<void> {
    // No cleanup needed for text protocol
  }
}
