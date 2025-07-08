import { Tool } from '../shared/tool';

/**
 * Interface for tool search strategy implementations
 */
export interface ToolSearchStrategy {
  /**
   * Search for tools based on the strategy
   * @param tools Array of tools to search in
   * @param query Search query
   * @returns Array of matching tools
   */
  search(tools: Tool[], query: string): Tool[];
}
