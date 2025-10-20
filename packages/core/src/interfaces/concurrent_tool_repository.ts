// packages/core/src/interfaces/concurrent_tool_repository.ts
import { CallTemplate } from '../data/call_template';
import { Tool } from '../data/tool';
import { UtcpManual } from '../data/utcp_manual';
import { Serializer } from './serializer';
import z from 'zod';


/**
 * Defines the contract for tool repositories that store and manage UTCP tools
 * and their associated call templates.
 *
 * Repositories are responsible for:
 * - Persisting call template configurations and their associated tools.
 * - Providing efficient lookup and retrieval operations.
 * - Managing relationships between call templates and tools.
 * - Ensuring data consistency across concurrent asynchronous calls.
 */
export interface ConcurrentToolRepository {
  /**
   * A string identifying the type of this tool repository (e.g., 'in_memory', 'database').
   * This is used for configuration and plugin lookup.
   */
  tool_repository_type: string;

  /**
   * Saves a manual's call template and its associated tools in the repository.
   * This operation replaces any existing manual with the same name.
   *
   * @param manualCallTemplate The call template associated with the manual to save.
   * @param manual The complete UTCP Manual object to save.
   * @returns A Promise that resolves when the operation is complete.
   */
  saveManual(manualCallTemplate: CallTemplate, manual: UtcpManual): Promise<void>;

  /**
   * Removes a manual and its tools from the repository.
   *
   * @param manualName The name of the manual (which corresponds to the CallTemplate name) to remove.
   * @returns A Promise resolving to true if the manual was removed, False otherwise.
   */
  removeManual(manualName: string): Promise<boolean>;

  /**
   * Removes a specific tool from the repository.
   *
   * @param toolName The full namespaced name of the tool to remove (e.g., "my_manual.my_tool").
   * @returns A Promise resolving to true if the tool was removed, False otherwise.
   */
  removeTool(toolName: string): Promise<boolean>;

  /**
   * Retrieves a tool by its full namespaced name.
   *
   * @param toolName The full namespaced name of the tool to retrieve.
   * @returns A Promise resolving to the tool if found, otherwise undefined.
   */
  getTool(toolName: string): Promise<Tool | undefined>;

  /**
   * Retrieves all tools from the repository.
   *
   * @returns A Promise resolving to a list of all registered tools.
   */
  getTools(): Promise<Tool[]>;

  /**
   * Retrieves all tools associated with a specific manual.
   *
   * @param manualName The name of the manual.
   * @returns A Promise resolving to a list of tools associated with the manual, or undefined if the manual is not found.
   */
  getToolsByManual(manualName: string): Promise<Tool[] | undefined>;

  /**
   * Retrieves a complete UTCP Manual object by its name.
   *
   * @param manualName The name of the manual to retrieve.
   * @returns A Promise resolving to the manual if found, otherwise undefined.
   */
  getManual(manualName: string): Promise<UtcpManual | undefined>;

  /**
   * Retrieves all registered manuals from the repository.
   *
   * @returns A Promise resolving to a list of all registered UtcpManual objects.
   */
  getManuals(): Promise<UtcpManual[]>;

  /**
   * Retrieves a manual's CallTemplate by its name.
   *
   * @param manualCallTemplateName The name of the manual's CallTemplate to retrieve.
   * @returns A Promise resolving to the CallTemplate if found, otherwise undefined.
   */
  getManualCallTemplate(manualCallTemplateName: string): Promise<CallTemplate | undefined>;

  /**
   * Retrieves all registered manual CallTemplates from the repository.
   *
   * @returns A Promise resolving to a list of all registered CallTemplateBase objects.
   */
  getManualCallTemplates(): Promise<CallTemplate[]>;
}

export class ConcurrentToolRepositoryConfigSerializer extends Serializer<ConcurrentToolRepository> {
  private static implementations: Record<string, Serializer<ConcurrentToolRepository>> = {};
  static default_strategy = "in_memory";

  // No need for the whole plugin registry. Plugins just need to call this to register a new repository
  static registerRepository(type: string, serializer: Serializer<ConcurrentToolRepository>, override = false): boolean {
    if (!override && ConcurrentToolRepositoryConfigSerializer.implementations[type]) {
      return false;
    }
    ConcurrentToolRepositoryConfigSerializer.implementations[type] = serializer;
    return true;
  }

  toDict(obj: ConcurrentToolRepository): Record<string, unknown> {
    const serializer = ConcurrentToolRepositoryConfigSerializer.implementations[obj.tool_repository_type];
    if (!serializer) throw new Error(`No serializer for type: ${obj.tool_repository_type}`);
    return serializer.toDict(obj);
  }

  validateDict(data: Record<string, unknown>): ConcurrentToolRepository {
    const serializer = ConcurrentToolRepositoryConfigSerializer.implementations[data["tool_repository_type"] as string];
    if (!serializer) throw new Error(`Invalid tool repository type: ${data["tool_repository_type"]}`);
    return serializer.validateDict(data);
  }
}

export const ConcurrentToolRepositorySchema = z
  .custom<ConcurrentToolRepository>((obj) => {
    try {
      // Use the centralized serializer to validate & return the correct subtype
      const validated = new ConcurrentToolRepositoryConfigSerializer().validateDict(obj as Record<string, unknown>);
      return validated;
    } catch (e) {
      return false; // z.custom treats false as validation failure
    }
  }, {
    message: "Invalid ConcurrentToolRepository object",
  });