// packages/core/src/interfaces/utcp_client_interface.ts
import { UtcpClientConfig } from "../client/utcp_client_config";
import { CallTemplate } from "../data/call_template";
import { Tool } from "../data/tool";
import { RegisterManualResult } from "../data/register_manual_result";

/**
 * REQUIRED
 * Abstract interface for UTCP client implementations.
 * 
 * Defines the core contract for UTCP clients, including CallTemplate management,
 * tool execution, search capabilities, and variable handling. This interface
 * allows for different client implementations while maintaining consistency.
 */
export interface IUtcpClient {
  /**
   * The client's complete and immutable configuration object.
   */
  readonly config: UtcpClientConfig;

  /**
   * The root directory for the client to resolve relative paths from.
   */
  readonly root_dir: string | null;

  /**
   * REQUIRED
   * Register a tool CallTemplate and its tools.
   *
   * @param manualCallTemplate The CallTemplate to register.
   * @returns A Promise resolving to a RegisterManualResult object containing the registered CallTemplate and its tools.
   */
  registerManual(manualCallTemplate: CallTemplate): Promise<RegisterManualResult>;

  /**
   * REQUIRED
   * Register multiple tool CallTemplates and their tools.
   *
   * @param manualCallTemplates List of CallTemplates to register.
   * @returns A Promise resolving to a list of RegisterManualResult objects containing the registered CallTemplates and their tools. Order is not preserved.
   */
  registerManuals(manualCallTemplates: CallTemplate[]): Promise<RegisterManualResult[]>;

  /**
   * REQUIRED
   * Deregister a tool CallTemplate.
   *
   * @param manualCallTemplateName The name of the CallTemplate to deregister.
   * @returns A Promise resolving to true if the CallTemplate was deregistered, false otherwise.
   */
  deregisterManual(manualCallTemplateName: string): Promise<boolean>;

  /**
   * REQUIRED
   * Call a tool.
   *
   * @param toolName The name of the tool to call.
   * @param toolArgs The arguments to pass to the tool.
   * @returns A Promise resolving to the result of the tool call.
   */
  callTool(toolName: string, toolArgs: Record<string, any>): Promise<any>;

  /**
   * REQUIRED
   * Call a tool streamingly.
   *
   * @param toolName The name of the tool to call.
   * @param toolArgs The arguments to pass to the tool.
   * @returns An async generator that yields the result of the tool call.
   */
  callToolStreaming(toolName: string, toolArgs: Record<string, any>): AsyncGenerator<any, void, unknown>;

  /**
   * REQUIRED
   * Search for tools relevant to the query.
   *
   * @param query The search query.
   * @param limit The maximum number of tools to return. 0 for no limit.
   * @param anyOfTagsRequired Optional list of tags where one of them must be present in the tool's tags
   * @returns A Promise resolving to a list of tools that match the search query.
   */
  searchTools(query: string, limit?: number, anyOfTagsRequired?: string[]): Promise<Tool[]>;

  /**
   * REQUIRED
   * Gets the required namespaced variables for a manual CallTemplate and its discovered tools.
   *
   * @param manualCallTemplate The CallTemplate instance of the manual.
   * @returns A Promise resolving to a list of required, fully-qualified variable names.
   */
  getRequiredVariablesForManualAndTools(manualCallTemplate: CallTemplate): Promise<string[]>;

  /**
   * REQUIRED
   * Gets the required namespaced variables for an already registered tool.
   *
   * @param toolName The full namespaced name of the registered tool (e.g., 'manual_name.tool_name').
   * @returns A Promise resolving to a list of required, fully-qualified variable names.
   */
  getRequiredVariablesForRegisteredTool(toolName: string): Promise<string[]>;
}