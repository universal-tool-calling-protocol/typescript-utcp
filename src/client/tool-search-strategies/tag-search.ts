import { Tool } from '../../shared/tool';
import { ToolSearchStrategy } from '../tool-search-strategy';

/**
 * Tag-based search strategy for tools
 */
export class TagSearchStrategy implements ToolSearchStrategy {
  search(tools: Tool[], query: string): Tool[] {
    const queryTags = query.split(',').map(tag => tag.trim().toLowerCase());
    
    return tools.filter(tool => {
      const toolTags = tool.tags.map(tag => tag.toLowerCase());
      return queryTags.some(queryTag => 
        toolTags.some(toolTag => toolTag.includes(queryTag))
      );
    });
  }
}
