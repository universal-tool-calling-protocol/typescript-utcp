import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool } from '../shared/tool';
import { Provider, ProviderUnion, ProviderUnionSchema } from '../shared/provider';
import { UtcpManual, UtcpManualSchema } from '../shared/utcp-manual';
import { UtcpClientConfig, UtcpClientConfigSchema, resolveConfigVariables } from './utcp-client-config';
import { ToolRepository } from './tool-repository';
import { InMemoryToolRepository } from './tool-repositories/in-memory-tool-repository';
import { ToolSearchStrategy } from './tool-search-strategy';
import { TagSearchStrategy } from './tool-search-strategies/tag-search';
import { ClientTransportInterface } from './transport-interfaces/client-transport-interface';
import { HttpClientTransport } from './transport-interfaces/http-transport';
import { WebSocketClientTransport } from './transport-interfaces/websocket-transport';
import { CliClientTransport } from './transport-interfaces/cli-transport';

/**
 * Interface for UTCP client
 */
export interface UtcpClientInterface {
  /**
   * Register a tool provider and its tools
   * @param provider The provider to register
   * @returns A list of tools associated with the provider
   */
  registerToolProvider(provider: ProviderUnion): Promise<Tool[]>;

  /**
   * Deregister a tool provider
   * @param providerName The name of the provider to deregister
   */
  deregisterToolProvider(providerName: string): void;

  /**
   * Call a tool
   * @param toolName The name of the tool to call
   * @param args Arguments to pass to the tool
   * @returns The result of the tool call
   */
  callTool(toolName: string, args: Record<string, any>): Promise<any>;

  /**
   * Get all available tools
   * @returns Array of all tools
   */
  getAvailableTools(): Tool[];

  /**
   * Search for tools
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
}

/**
 * Main UTCP client implementation
 */
export class UtcpClient implements UtcpClientInterface {
  private config: UtcpClientConfig;
  private toolRepository: ToolRepository;
  private searchStrategy: ToolSearchStrategy;
  private transports: ClientTransportInterface[];
  private registeredProviders: Map<string, ProviderUnion> = new Map();

  constructor(config: UtcpClientConfig) {
    this.config = UtcpClientConfigSchema.parse(config);
    this.toolRepository = new InMemoryToolRepository();
    this.searchStrategy = new TagSearchStrategy();
    this.transports = [
      new HttpClientTransport(),
      new WebSocketClientTransport(),
      new CliClientTransport(),
    ];
  }

  /**
   * Create a new UTCP client instance
   * @param config Configuration for the client
   * @returns Promise resolving to the client instance
   */
  static async create(config: UtcpClientConfig): Promise<UtcpClient> {
    const client = new UtcpClient(config);
    await client.initialize();
    return client;
  }

  private async initialize(): Promise<void> {
    // Load providers from file if specified
    if (this.config.providers_file_path) {
      await this.loadProvidersFromFile(this.config.providers_file_path);
    }

    // Load providers from config if specified
    if (this.config.providers) {
      for (const providerConfig of this.config.providers) {
        const resolvedConfig = resolveConfigVariables(providerConfig);
        const provider = ProviderUnionSchema.parse(resolvedConfig);
        await this.registerToolProvider(provider);
      }
    }

    // Initialize transports
    for (const transport of this.transports) {
      if (transport.initialize) {
        await transport.initialize();
      }
    }
  }

  private async loadProvidersFromFile(filePath: string): Promise<void> {
    try {
      const absolutePath = path.resolve(filePath);
      const fileContent = await fs.readFile(absolutePath, 'utf-8');
      const providers = JSON.parse(fileContent);
      
      if (!Array.isArray(providers)) {
        throw new Error('Providers file must contain an array of providers');
      }

      for (const providerConfig of providers) {
        const resolvedConfig = resolveConfigVariables(providerConfig);
        const provider = ProviderUnionSchema.parse(resolvedConfig);
        await this.registerToolProvider(provider);
      }
    } catch (error) {
      throw new Error(`Failed to load providers from file ${filePath}: ${error}`);
    }
  }

  async registerToolProvider(provider: ProviderUnion): Promise<Tool[]> {
    if (this.registeredProviders.has(provider.name)) {
      throw new Error(`Provider ${provider.name} is already registered`);
    }

    // Fetch tools from the provider
    const tools = await this.fetchToolsFromProvider(provider);
    
    // Add tools to repository
    for (const tool of tools) {
      this.toolRepository.addTool(tool);
    }

    this.registeredProviders.set(provider.name, provider);
    return tools;
  }

  private async fetchToolsFromProvider(provider: ProviderUnion): Promise<Tool[]> {
    // For HTTP providers, try to fetch a UTCP manual
    if (provider.provider_type === 'http') {
      try {
        const httpTransport = this.transports.find(t => t.canHandle({ 
          name: 'manual', 
          provider, 
          description: '', 
          inputs: { type: 'object', properties: {} }, 
          outputs: { type: 'object', properties: {} }, 
          tags: [] 
        })) as HttpClientTransport;

        if (httpTransport) {
          const manualResponse = await httpTransport.callTool({
            name: 'manual',
            provider,
            description: '',
            inputs: { type: 'object', properties: {} },
            outputs: { type: 'object', properties: {} },
            tags: []
          }, {});

          const manual = UtcpManualSchema.parse(manualResponse);
          return manual.tools;
        }
      } catch (error) {
        console.warn(`Failed to fetch manual from provider ${provider.name}:`, error);
      }
    }

    // For other provider types or if manual fetch fails, return empty array
    // In a real implementation, this would be provider-specific
    return [];
  }

  deregisterToolProvider(providerName: string): void {
    if (!this.registeredProviders.has(providerName)) {
      throw new Error(`Provider ${providerName} is not registered`);
    }

    this.toolRepository.removeToolsByProvider(providerName);
    this.registeredProviders.delete(providerName);
  }

  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    const tool = this.toolRepository.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    // Find appropriate transport
    const transport = this.transports.find(t => t.canHandle(tool));
    if (!transport) {
      throw new Error(`No transport available for tool ${toolName} with provider type ${tool.provider.provider_type}`);
    }

    // Call the tool with retry logic
    return this.callToolWithRetry(transport, tool, args);
  }

  private async callToolWithRetry(
    transport: ClientTransportInterface, 
    tool: Tool, 
    args: Record<string, any>
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retry_attempts; attempt++) {
      try {
        return await transport.callTool(tool, args);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.config.retry_attempts - 1) {
          await this.sleep(this.config.retry_delay * Math.pow(2, attempt));
        }
      }
    }

    throw lastError || new Error('Tool call failed after retries');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getAvailableTools(): Tool[] {
    return this.toolRepository.getAllTools();
  }

  searchTools(query: string): Tool[] {
    const allTools = this.toolRepository.getAllTools();
    return this.searchStrategy.search(allTools, query);
  }

  getToolsByTag(tag: string): Tool[] {
    return this.toolRepository.getToolsByTag(tag);
  }

  async cleanup(): Promise<void> {
    // Cleanup transports
    for (const transport of this.transports) {
      if (transport.cleanup) {
        await transport.cleanup();
      }
    }

    // Clear repository
    this.toolRepository.clear();
    this.registeredProviders.clear();
  }
}
