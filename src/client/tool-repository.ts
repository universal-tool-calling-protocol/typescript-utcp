import { Tool } from '../shared/tool';

/**
 * Interface for tool repository implementations
 */
export interface ToolRepository {
  /**
   * Add a tool to the repository
   * @param tool The tool to add
   */
  addTool(tool: Tool): void;

  /**
   * Remove a tool from the repository
   * @param toolName The name of the tool to remove
   */
  removeTool(toolName: string): void;

  /**
   * Remove all tools from a specific provider
   * @param providerName The name of the provider
   */
  removeToolsByProvider(providerName: string): void;

  /**
   * Get a tool by name
   * @param toolName The name of the tool
   * @returns The tool if found, undefined otherwise
   */
  getTool(toolName: string): Tool | undefined;

  /**
   * Get all tools in the repository
   * @returns Array of all tools
   */
  getAllTools(): Tool[];

  /**
   * Search for tools by various criteria
   * @param query Search query
   * @returns Array of matching tools
   */
  searchTools(query: string): Tool[];

  /**
   * Get tools by tag
   * @param tag The tag to search for
   * @returns Array of tools with the specified tag
   */
  getToolsByTag(tag: string): Tool[];

  /**
   * Clear all tools from the repository
   */
  clear(): void;
}
