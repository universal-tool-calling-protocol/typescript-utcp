import { ProviderUnion } from '../../shared/provider';
import { Tool } from '../../shared/tool';
import { ToolRepository } from '../tool-repository';

/**
 * An in-memory implementation of the ToolRepository.
 * This repository stores tools and providers in memory and does not persist them.
 */
export class InMemToolRepository implements ToolRepository {
  private tools: Tool[] = [];
  private toolPerProvider: Map<string, { provider: ProviderUnion; tools: Tool[] }> = new Map();

  public async saveProviderWithTools(provider: ProviderUnion, tools: Tool[]): Promise<void> {
    this.tools.push(...tools);
    this.toolPerProvider.set(provider.name, { provider, tools });
    return Promise.resolve();
  }

  public async removeProvider(providerName: string): Promise<void> {
    const providerData = this.toolPerProvider.get(providerName);
    if (!providerData) {
      throw new Error(`Provider '${providerName}' not found`);
    }

    const toolsToRemove = new Set(providerData.tools);
    this.tools = this.tools.filter(tool => !toolsToRemove.has(tool));
    this.toolPerProvider.delete(providerName);

    return Promise.resolve();
  }

  public async removeTool(toolName: string): Promise<void> {
    const providerName = toolName.split('.')[0]!!;
    const providerData = this.toolPerProvider.get(providerName);

    if (!providerData) {
      throw new Error(`Provider '${providerName}' not found`);
    }

    const initialToolCount = this.tools.length;
    this.tools = this.tools.filter(tool => tool.name !== toolName);

    if (this.tools.length === initialToolCount) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    providerData.tools = providerData.tools.filter(tool => tool.name !== toolName);
    this.toolPerProvider.set(providerName, providerData);

    return Promise.resolve();
  }

  public async getTool(toolName: string): Promise<Tool | undefined> {
    return Promise.resolve(this.tools.find(tool => tool.name === toolName));
  }

  public async getTools(): Promise<Tool[]> {
    return Promise.resolve(this.tools);
  }

  public async getToolsByProvider(providerName: string): Promise<Tool[] | undefined> {
    const providerData = this.toolPerProvider.get(providerName);
    return Promise.resolve(providerData?.tools);
  }

  public async getProvider(providerName: string): Promise<ProviderUnion | undefined> {
    const providerData = this.toolPerProvider.get(providerName);
    return Promise.resolve(providerData?.provider);
  }

  public async getProviders(): Promise<ProviderUnion[]> {
    const providers = Array.from(this.toolPerProvider.values()).map(data => data.provider);
    return Promise.resolve(providers);
  }
}
