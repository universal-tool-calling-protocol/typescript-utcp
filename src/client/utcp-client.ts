import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { parse } from 'dotenv';

import { HttpProvider, Provider, ProviderSchema, ProviderUnion, ProviderUnionSchema, TextProvider } from '../shared/provider';
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
   * @param provider The provider to register.
   * @returns A promise that resolves to a list of tools associated with the provider.
   */
  registerToolProvider(provider: ProviderUnion): Promise<Tool[]>;

  /**
   * Deregisters a tool provider.
   *
   * @param providerName The name of the provider to deregister.
   * @returns A promise that resolves when the provider is deregistered.
   */
  deregisterToolProvider(providerName: string): Promise<void>;

  /**
   * Calls a tool with the given arguments.
   *
   * @param toolName The name of the tool to call (e.g., 'providerName.toolName').
   * @param args The arguments to pass to the tool.
   * @returns A promise that resolves to the result of the tool call.
   */
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;

  /**
   * Searches for tools relevant to the query.
   *
   * @param query The search query.
   * @param limit The maximum number of tools to return. 0 for no limit.
   * @returns A promise that resolves to a list of tools that match the search query.
   */
  searchTools(query: string, limit?: number): Promise<Tool[]>;
}

/**
 * The main client for interacting with the Universal Tool Calling Protocol (UTCP).
 */
export class UtcpClient implements UtcpClientInterface {
  private readonly httpTransport = new HttpClientTransport();
  private readonly textTransport = new TextTransport();

  private constructor(
    public readonly config: UtcpClientConfig,
    readonly toolRepository: ToolRepository,
    readonly searchStrategy: ToolSearchStrategy,
  ) {}

  /**
   * Creates and initializes a new instance of the UtcpClient.
   *
   * @param config The configuration for the client. Can be a partial config object.
   * @param toolRepository The tool repository to use. Defaults to InMemToolRepository.
   * @param searchStrategy The tool search strategy to use. Defaults to TagSearchStrategy.
   * @returns A promise that resolves to a new, initialized instance of UtcpClient.
   */
  public static async create(
    config: Partial<UtcpClientConfig> = {},
    toolRepository: ToolRepository = new InMemToolRepository(),
    searchStrategy?: ToolSearchStrategy,
  ): Promise<UtcpClient> {
    const validatedConfig = UtcpClientConfigSchema.parse(config);

    const finalSearchStrategy = searchStrategy ?? new TagSearchStrategy(toolRepository);

    const client = new UtcpClient(
      validatedConfig,
      toolRepository,
      finalSearchStrategy,
    );

    await client.loadVariables();
    await client.loadProvidersFromFile();

    return client;
  }

  public async registerToolProvider(provider: ProviderUnion): Promise<Tool[]> {
    const processedProvider = await this.substituteProviderVariables(provider);
    let tools: Tool[];

    switch (processedProvider.provider_type) {
      case 'http':
        tools = await this.httpTransport.register_tool_provider(processedProvider);
        break;
      case 'text':
        tools = await this.textTransport.register_tool_provider(processedProvider);
        break;
      default:
        throw new Error(`Provider type not supported: ${processedProvider.provider_type}`);
    }

    // Ensure tool names are prefixed with the provider name
    for (const tool of tools) {
      if (!tool.name.startsWith(`${processedProvider.name}.`)) {
        tool.name = `${processedProvider.name}.${tool.name}`;
      }
    }

    await this.toolRepository.saveProviderWithTools(processedProvider, tools);
    return tools;
  }

  public async deregisterToolProvider(providerName: string): Promise<void> {
    const provider = await this.toolRepository.getProvider(providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    switch (provider.provider_type) {
      case 'http':
        await this.httpTransport.deregister_tool_provider(provider);
        break;
      case 'text':
        await this.textTransport.deregister_tool_provider(provider);
        break;
      // No default case needed if we just want to ignore unsupported types
    }

    await this.toolRepository.removeProvider(providerName);
  }

  public async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const providerName = toolName.split('.')[0];
    if (!providerName) {
      throw new Error('Invalid tool name format. Expected provider_name.tool_name');
    }

    const tool = await this.toolRepository.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const provider = await this.substituteProviderVariables(tool.provider);

    switch (provider.provider_type) {
      case 'http':
        return this.httpTransport.call_tool(toolName, args, provider);
      case 'text':
        return this.textTransport.call_tool(toolName, args, provider);
      default:
        throw new Error(`Transport for provider type ${provider.provider_type} not found.`);
    }
  }

  public searchTools(query: string, limit: number = 10): Promise<Tool[]> {
    return this.searchStrategy.searchTools(query, limit);
  }

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
          await this.registerToolProvider(provider);
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
      const regex = /\$\{([^}]+)\}/g;
      let result = obj;
      let match;
      while ((match = regex.exec(obj)) !== null) {
        const varName = match[1]!;
        const varValue = await this.getVariable(varName);
        result = result.replace(match[0], varValue);
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
