import { ProviderUnion } from '../shared/provider';
import { Tool } from '../shared/tool';

/**
 * Defines the interface for a tool repository, which is responsible for storing,
 * retrieving, and managing tools and their providers.
 */
export interface ToolRepository {
  /**
   * Saves a provider and its associated tools in the repository.
   *
   * @param provider The provider to save.
   * @param tools The list of tools associated with the provider.
   */
  saveProviderWithTools(provider: ProviderUnion, tools: Tool[]): Promise<void>;

  /**
   * Removes a provider and all its associated tools from the repository.
   *
   * @param providerName The name of the provider to remove.
   * @throws Will throw an error if the provider is not found.
   */
  removeProvider(providerName: string): Promise<void>;

  /**
   * Removes a specific tool from the repository.
   *
   * @param toolName The name of the tool to remove.
   * @throws Will throw an error if the tool is not found.
   */
  removeTool(toolName: string): Promise<void>;

  /**
   * Retrieves a tool by its name.
   *
   * @param toolName The name of the tool to retrieve.
   * @returns A promise that resolves to the tool if found, otherwise undefined.
   */
  getTool(toolName: string): Promise<Tool | undefined>;

  /**
   * Retrieves all tools from the repository.
   *
   * @returns A promise that resolves to a list of all tools.
   */
  getTools(): Promise<Tool[]>;

  /**
   * Retrieves all tools associated with a specific provider.
   *
   * @param providerName The name of the provider.
   * @returns A promise that resolves to a list of tools for the provider, or undefined if the provider is not found.
   */
  getToolsByProvider(providerName: string): Promise<Tool[] | undefined>;

  /**
   * Retrieves a provider by its name.
   *
   * @param providerName The name of the provider to retrieve.
   * @returns A promise that resolves to the provider if found, otherwise undefined.
   */
  getProvider(providerName: string): Promise<ProviderUnion | undefined>;

  /**
   * Retrieves all providers from the repository.
   *
   * @returns A promise that resolves to a list of all providers.
   */
  getProviders(): Promise<ProviderUnion[]>;
}
