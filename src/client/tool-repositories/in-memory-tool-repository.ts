import { Tool } from '../../shared/tool';
import { ToolRepository } from '../tool-repository';

/**
 * In-memory implementation of ToolRepository
 */
export class InMemoryToolRepository implements ToolRepository {
  private tools: Map<string, Tool> = new Map();

  addTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  removeTool(toolName: string): void {
    this.tools.delete(toolName);
  }

  removeToolsByProvider(providerName: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.provider.name === providerName) {
        this.tools.delete(name);
      }
    }
  }

  getTool(toolName: string): Tool | undefined {
    return this.tools.get(toolName);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  searchTools(query: string): Tool[] {
    const lowercaseQuery = query.toLowerCase();
    return this.getAllTools().filter(tool => 
      tool.name.toLowerCase().includes(lowercaseQuery) ||
      tool.description.toLowerCase().includes(lowercaseQuery) ||
      tool.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery))
    );
  }

  getToolsByTag(tag: string): Tool[] {
    return this.getAllTools().filter(tool => 
      tool.tags.includes(tag)
    );
  }

  clear(): void {
    this.tools.clear();
  }
}
