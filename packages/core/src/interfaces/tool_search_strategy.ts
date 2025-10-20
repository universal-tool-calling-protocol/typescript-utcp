// packages/core/src/interfaces/tool_search_strategy.ts
import { Tool } from '../data/tool';
import { ConcurrentToolRepository } from './concurrent_tool_repository';
import { Serializer } from './serializer';
import z from 'zod';


/**
 * Defines the contract for tool search strategies that can be plugged into
 * the UTCP client. Implementations provide algorithms for searching and ranking tools.
 */
export interface ToolSearchStrategy {
  /**
   * A string identifying the type of this tool search strategy (e.g., 'tag_and_description_word_match', 'in_mem_embeddings').
   * This is used for configuration and plugin lookup.
   */
  tool_search_strategy_type: string;

  /**
   * Searches for tools relevant to the query within a given tool repository.
   *
   * @param toolRepository The repository to search within.
   * @param query The search query string. Format depends on the strategy (e.g., keywords, natural language).
   * @param limit Maximum number of tools to return. Use 0 for no limit.
   * @param anyOfTagsRequired Optional list of tags where one of them must be present in the tool's tags.
   * @returns A Promise resolving to a list of Tool objects ranked by relevance.
   */
  searchTools(
    toolRepository: ConcurrentToolRepository,
    query: string,
    limit?: number,
    anyOfTagsRequired?: string[]
  ): Promise<Tool[]>;
}

export class ToolSearchStrategyConfigSerializer extends Serializer<ToolSearchStrategy> {
  private static implementations: Record<string, Serializer<ToolSearchStrategy>> = {};
  static default_strategy = "tag_and_description_word_match";

  // No need for the whole plugin registry. Plugins just need to call this to register a new strategy
  static registerStrategy(type: string, serializer: Serializer<ToolSearchStrategy>, override = false): boolean  {
    if (!override && ToolSearchStrategyConfigSerializer.implementations[type]) {
      return false;
    }
    ToolSearchStrategyConfigSerializer.implementations[type] = serializer;
    return true;
  }

  toDict(obj: ToolSearchStrategy): Record<string, unknown> {
    const serializer = ToolSearchStrategyConfigSerializer.implementations[obj.tool_search_strategy_type];
    if (!serializer) throw new Error(`No serializer for type: ${obj.tool_search_strategy_type}`);
    return serializer.toDict(obj);
  }

  validateDict(data: Record<string, unknown>): ToolSearchStrategy {
    const serializer = ToolSearchStrategyConfigSerializer.implementations[data["tool_search_strategy_type"] as string];
    if (!serializer) throw new Error(`Invalid tool search strategy type: ${data["tool_search_strategy_type"]}`);
    return serializer.validateDict(data);
  }
}

export const ToolSearchStrategySchema = z
  .custom<ToolSearchStrategy>((obj) => {
    try {
      // Use the centralized serializer to validate & return the correct subtype
      const validated = new ToolSearchStrategyConfigSerializer().validateDict(obj as Record<string, unknown>);
      return validated;
    } catch (e) {
      return false; // z.custom treats false as validation failure
    }
  }, {
    message: "Invalid ToolSearchStrategy object",
  });