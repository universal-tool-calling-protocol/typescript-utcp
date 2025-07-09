import { Tool } from '../../shared/tool';
import { ToolRepository } from '../tool-repository';
import { ToolSearchStrategy } from '../tool-search-strategy';

/**
 * Implements a tool search strategy based on tag and description matching.
 * Tools are scored based on the occurrence of query words in their tags and description.
 */
export class TagSearchStrategy implements ToolSearchStrategy {
  /**
   * Weight for description words vs. explicit tags (explicit tags have a weight of 1.0).
   */
  private readonly descriptionWeight: number;

  /**
   * Creates an instance of TagSearchStrategy.
   *
   * @param toolRepository The repository to search for tools.
   * @param descriptionWeight The weight to apply to words found in the tool's description.
   */
  constructor(
    private readonly toolRepository: ToolRepository,
    descriptionWeight: number = 0.3,
  ) {
    this.descriptionWeight = descriptionWeight;
  }

  /**
   * Searches for tools by matching tags and description content against a query.
   *
   * @param query The search query string.
   * @param limit The maximum number of tools to return. If 0, all matched tools are returned.
   * @returns A promise that resolves to a list of tools ordered by relevance.
   */
  public async searchTools(query: string, limit: number = 10): Promise<Tool[]> {
    const queryLower = query.toLowerCase();
    const queryWords = new Set(queryLower.match(/\w+/g) || []);

    const tools = await this.toolRepository.getTools();

    const toolScores = tools.map(tool => {
      let score = 0.0;

      // Score from explicit tags (weight 1.0)
      if (tool.tags) {
        for (const tag of tool.tags) {
          const tagLower = tag.toLowerCase();
          if (queryLower.includes(tagLower)) {
            score += 1.0;
          }

          // Score from words within the tag
          const tagWords = new Set(tagLower.match(/\w+/g) || []);
          for (const word of tagWords) {
            if (queryWords.has(word)) {
              score += this.descriptionWeight; // Partial match for tag words
            }
          }
        }
      }

      // Score from description (with lower weight)
      if (tool.description) {
        const descriptionWords = new Set(
          tool.description.toLowerCase().match(/\w+/g) || [],
        );
        for (const word of descriptionWords) {
          if (queryWords.has(word) && word.length > 2) {
            score += this.descriptionWeight;
          }
        }
      }

      return { tool, score };
    });

    // Sort tools by score in descending order
    const sortedTools = toolScores
      .sort((a, b) => b.score - a.score)
      .map(item => item.tool);

    // Return up to 'limit' tools, or all if limit is 0
    return limit > 0 ? sortedTools.slice(0, limit) : sortedTools;
  }
}
