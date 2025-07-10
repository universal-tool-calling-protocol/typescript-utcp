import { Tool } from '../shared/tool';

/**
 * Defines the interface for a tool search strategy.
 */
export interface ToolSearchStrategy {
  /**
   * Searches for tools relevant to the query.
   *
   * @param query The search query.
   * @param limit The maximum number of tools to return. 0 for no limit.
   * @returns A promise that resolves to a list of tools that match the search query.
   */
  searchTools(query: string, limit?: number): Promise<Tool[]>;
}
