import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { parse } from 'dotenv';

import { 
  HttpProvider, 
  Provider, 
  ProviderSchema, 
  ProviderUnion, 
  ProviderUnionSchema, 
  TextProvider,
  CliProvider, 
  SSEProvider, 
  StreamableHttpProvider,
  WebSocketProvider,
  GRPCProvider,
  GraphQLProvider,
  TCPProvider,
  UDPProvider,
  WebRTCProvider,
  MCPProvider 
} from '../shared/provider';
import { Tool } from '../shared/tool';
import { ClientTransportInterface } from './client-transport-interface';
import { InMemToolRepository } from './tool-repositories/in-mem-tool-repository';
import { ToolRepository } from './tool-repository';
import { TagSearchStrategy } from './tool-search-strategies/tag-search';
import { ToolSearchStrategy } from './tool-search-strategy';
import {
  UtcpClientConfig,
  UtcpClientConfigSchema,
  UtcpVariableNotFoundError,
} from './utcp-client-config';
import { HttpClientTransport } from './transport-interfaces/http-transport';
import { TextTransport } from './transport-interfaces/text-transport';

/**
 * Interface for a UTCP client.
 */
export interface UtcpClientInterface {
  /**
   * Registers a tool provider and its tools.
   *
   * @param manual_provider The provider to register.
   * @returns A promise that resolves to a list of tools associated with the provider.
   */
  register_tool_provider(manual_provider: ProviderUnion): Promise<Tool[]>;

  /**
   * Deregisters a tool provider.
   *
   * @param provider_name The name of the provider to deregister.
   * @returns A promise that resolves when the provider is deregistered.
   */
  deregister_tool_provider(provider_name: string): Promise<void>;

  /**
   * Calls a tool with the given arguments.
   *
   * @param tool_name The name of the tool to call (e.g., 'providerName.toolName').
   * @param args The arguments to pass to the tool.
   * @returns A promise that resolves to the result of the tool call.
   */
  call_tool(tool_name: string, args: Record<string, unknown>): Promise<unknown>;

  /**
   * Searches for tools relevant to the query.
   *
   * @param query The search query.
   * @param limit The maximum number of tools to return. 0 for no limit.
   * @returns A promise that resolves to a list of tools that match the search query.
   */
  search_tools(query: string, limit?: number): Promise<Tool[]>;
}

/**
 * The main client for interacting with the Universal Tool Calling Protocol (UTCP).
 */
export class UtcpClient implements UtcpClientInterface {
  private transports: Record<string, ClientTransportInterface> = {
    'http': new HttpClientTransport(),
    'text': new TextTransport(),
  };

  private constructor(
    public readonly config: UtcpClientConfig,
    readonly toolRepository: ToolRepository,
    readonly searchStrategy: ToolSearchStrategy,
  ) {}

  /**
   * Creates and initializes a new instance of the UtcpClient.
   *
   * @param config The configuration for the client. Can be a partial config object or a complete UtcpClientConfig.
   * @param toolRepository The tool repository to use. Defaults to InMemToolRepository.
   * @param searchStrategy The tool search strategy to use. Defaults to TagSearchStrategy.
   * @returns A promise that resolves to a new, initialized instance of UtcpClient.
   */
  public static async create(
    config: Partial<UtcpClientConfig> | UtcpClientConfig = {},
    toolRepository: ToolRepository = new InMemToolRepository(),
    searchStrategy?: ToolSearchStrategy,
  ): Promise<UtcpClient> {
    let validatedConfig: UtcpClientConfig;
    
    if ('toJSON' in config && typeof config.toJSON === 'function') {
      // It's already a UtcpClientConfig instance
      validatedConfig = config as UtcpClientConfig;
    } else {
      validatedConfig = UtcpClientConfigSchema.parse(config);
    }

    const finalSearchStrategy = searchStrategy ?? new TagSearchStrategy(toolRepository);

    const client = new UtcpClient(
      validatedConfig,
      toolRepository,
      finalSearchStrategy,
    );

    // If a providers file is used, configure TextTransport to resolve relative paths from its directory
    if (client.config.providers_file_path) {
      const providersDir = path.dirname(path.resolve(client.config.providers_file_path));
      client.transports['text'] = new TextTransport(providersDir);
    }
    
    if (client.config.variables) {
      const configWithoutVars = { ...client.config };
      configWithoutVars.variables = {};
      client.config.variables = await client.replaceVarsInObj(client.config.variables);
    }

    await client.loadVariables();
    await client.loadProvidersFromFile();

    return client;
  }

  public async register_tool_provider(manual_provider: ProviderUnion): Promise<Tool[]> {
    const processedProvider = await this.substituteProviderVariables(manual_provider);
    processedProvider.name = processedProvider.name.replace('.', '_');
    
    if (!this.transports[processedProvider.provider_type]) {
      throw new Error(`Provider type not supported: ${processedProvider.provider_type}`);
    }
    
    const tools: Tool[] = await this.transports[processedProvider.provider_type]!!.register_tool_provider(processedProvider);

    // Ensure tool names are prefixed with the provider name
    for (const tool of tools) {
      if (!tool.name.startsWith(`${processedProvider.name}.`)) {
        tool.name = `${processedProvider.name}.${tool.name}`;
      }
    }

    await this.toolRepository.saveProviderWithTools(processedProvider, tools);
    return tools;
  }

  public async deregister_tool_provider(provider_name: string): Promise<void> {
    const provider = await this.toolRepository.getProvider(provider_name);
    if (!provider) {
      throw new Error(`Provider not found: ${provider_name}`);
    }

    if (this.transports[provider.provider_type]) {
      await this.transports[provider.provider_type]!!.deregister_tool_provider(provider);
    }

    await this.toolRepository.removeProvider(provider_name);
  }

  public async call_tool(tool_name: string, args: Record<string, unknown>): Promise<unknown> {
    const provider_name = tool_name.split('.')[0];
    if (!provider_name) {
      throw new Error('Invalid tool name format. Expected provider_name.tool_name');
    }

    const provider = await this.toolRepository.getProvider(provider_name);
    if (!provider) {
      throw new Error(`Provider not found: ${provider_name}`);
    }

    const tools = await this.toolRepository.getToolsByProvider(provider_name);
    const tool = tools?.find(t => t.name === tool_name);
    if (!tool) {
      throw new Error(`Tool not found: ${tool_name}`);
    }

    const processed_provider = await this.substituteProviderVariables(tool.tool_provider);

    if (!this.transports[processed_provider.provider_type]) {
      throw new Error(`Transport for provider type ${processed_provider.provider_type} not found.`);
    }

    return this.transports[processed_provider.provider_type]!!.call_tool(tool_name, args, processed_provider);
  }

  public search_tools(query: string, limit: number = 10): Promise<Tool[]> {
    return this.searchStrategy.searchTools(query, limit);
  }

  /**
   * Load providers from the file specified in the configuration.
   * 
   * @returns A promise that resolves to a list of registered Provider objects.
   * @throws FileNotFoundError if the providers file doesn't exist.
   * @throws Error if the providers file contains invalid JSON.
   * @throws UtcpVariableNotFoundError if a variable referenced in the provider configuration is not found.
   */
  private async loadProvidersFromFile(): Promise<void> {
    if (!this.config.providers_file_path) {
      return;
    }

    const filePath = path.resolve(this.config.providers_file_path);
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const providersData = JSON.parse(fileContent);

      if (!Array.isArray(providersData)) {
        throw new Error('Providers file must contain a JSON array at the root level.');
      }

      for (const providerData of providersData) {
        try {
          const provider = ProviderUnionSchema.parse(providerData);
          await this.register_tool_provider(provider);
          console.log(`Successfully registered provider '${provider.name}'`);
        } catch (error) {
          const providerName = (providerData as any)?.name || 'unknown';
          console.error(`Error registering provider '${providerName}':`, error);
        }
      }
    } catch (error) {
      console.error(`Failed to load providers from ${filePath}:`, error);
      throw error;
    }
  }

  private async loadVariables(): Promise<void> {
    if (!this.config.load_variables_from) {
      return;
    }
    for (const varConfig of this.config.load_variables_from) {
      if (varConfig.type === 'dotenv') {
        try {
          const envContent = await fs.readFile(varConfig.env_file_path, 'utf-8');
          const envVars = parse(envContent);
          this.config.variables = { ...envVars, ...this.config.variables };
        } catch (e) {
          console.warn(`Could not load .env file from ${varConfig.env_file_path}`);
        }
      }
    }
  }

  private async substituteProviderVariables<T extends Provider>(provider: T): Promise<T> {
    const providerDict = { ...provider };
    const processedDict = await this.replaceVarsInObj(providerDict);
    return ProviderUnionSchema.parse(processedDict) as unknown as T;
  }

  private async getVariable(key: string): Promise<string> {
    // 1. Check config.variables
    if (this.config.variables && key in this.config.variables) {
      return this.config.variables[key]!;
    }

    // 2. Check process.env
    if (process.env[key]) {
      return process.env[key]!;
    }

    throw new UtcpVariableNotFoundError(key);
  }

  private async replaceVarsInObj(obj: any): Promise<any> {
    if (typeof obj === 'string') {
      // Support both ${VAR} and $VAR formats like Python version
      const regex = /\$\{([^}]+)\}|\$(\w+)/g;
      let result = obj;
      let match;
      while ((match = regex.exec(obj)) !== null) {
        // The first group that is not undefined is the one that matched
        const varName = match[1] || match[2];
        if (!varName) continue;
        
        try {
          const varValue = await this.getVariable(varName);
          result = result.replace(match[0], varValue);
        } catch (error) {
          // Continue with other variables even if one fails
          console.warn(`Variable not found: ${varName}`);
        }
      }
      return result;
    }
    if (Array.isArray(obj)) {
      return Promise.all(obj.map(item => this.replaceVarsInObj(item)));
    }
    if (obj !== null && typeof obj === 'object') {
      const newObj: { [key: string]: any } = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          newObj[key] = await this.replaceVarsInObj(obj[key]);
        }
      }
      return newObj;
    }
    return obj;
  }
}
