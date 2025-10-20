// packages/core/src/client/utcp_client.ts
import { promises as fs } from 'fs';
import * as path from 'path';
import { parse as parseDotEnv } from 'dotenv';
import { CallTemplate, CallTemplateSchema } from '../data/call_template';
import { Tool } from '../data/tool';
import { UtcpManualSchema } from '../data/utcp_manual';
import { CommunicationProtocol } from '../interfaces/communication_protocol';
import { RegisterManualResult } from '../data/register_manual_result';
import { ConcurrentToolRepository } from '../interfaces/concurrent_tool_repository';
import { ToolSearchStrategy } from '../interfaces/tool_search_strategy';
import { VariableSubstitutor } from '../interfaces/variable_substitutor';
import { ToolPostProcessor } from '../interfaces/tool_post_processor';
import {
  UtcpClientConfig,
  UtcpClientConfigSchema,
} from './utcp_client_config';
import { DefaultVariableSubstitutor } from '../implementations/default_variable_substitutor';
import { ensureCorePluginsInitialized } from '../plugins/plugin_loader';
import { IUtcpClient } from '../interfaces/utcp_client_interface';
import { ToolSearchStrategyConfigSerializer } from '../interfaces/tool_search_strategy';
import { ToolPostProcessorConfigSerializer } from '../interfaces/tool_post_processor';
import { ConcurrentToolRepositoryConfigSerializer } from '../interfaces/concurrent_tool_repository';

/**
 * REQUIRED
 * Abstract interface for UTCP client implementations.
 *
 * Defines the core contract for UTCP clients, including CallTemplate management,
 * tool execution, search capabilities, and variable handling. This interface
 * allows for different client implementations while maintaining consistency.
 */
export class UtcpClient implements IUtcpClient {
  private _registeredCommProtocols: Map<string, CommunicationProtocol> = new Map();
  public readonly postProcessors: ToolPostProcessor[];

  private constructor(
    public readonly config: UtcpClientConfig,
    public readonly variableSubstitutor: VariableSubstitutor,
    public readonly root_dir: string | null = null,
  ) {
    // Dynamically populate registered protocols from the global registry
    for (const [type, protocol] of Object.entries(CommunicationProtocol.communicationProtocols)) {
      this._registeredCommProtocols.set(type, protocol);
    }
    // Instantiate post-processors dynamically based on registered factories
    this.postProcessors = config.post_processing.map(ppConfig => {
      const serializer = new ToolPostProcessorConfigSerializer();
      return serializer.validateDict(ppConfig as any) as ToolPostProcessor;
    });
  }

  /**
   * REQUIRED
   * Create a new instance of UtcpClient.
   * 
   * @param root_dir The root directory for the client to resolve relative paths from. Defaults to the current working directory.
   * @param config The configuration for the client. Can be a path to a configuration file, a dictionary, or UtcpClientConfig object.
   * @returns A new instance of UtcpClient.
   */
  public static async create(
    root_dir: string = process.cwd(),
    config: Partial<UtcpClientConfig> | string = {}
  ): Promise<UtcpClient> {
    // Ensure core plugins are initialized before parsing config
    ensureCorePluginsInitialized();

    let loadedConfig: Partial<UtcpClientConfig>;
    if (typeof config === 'string') {
        const configPath = path.resolve(root_dir, config);
        const configFileContent = await fs.readFile(configPath, 'utf-8');
        loadedConfig = JSON.parse(configFileContent);
    } else {
        loadedConfig = config;
    }

    const validatedConfig = UtcpClientConfigSchema.parse(loadedConfig);

    // Dynamically instantiate ConcurrentToolRepository
    const repoSerializer = new ConcurrentToolRepositoryConfigSerializer();
    const concurrentToolRepository = repoSerializer.validateDict(validatedConfig.tool_repository as any) as ConcurrentToolRepository;

    // Dynamically instantiate ToolSearchStrategy
    const searchStrategySerializer = new ToolSearchStrategyConfigSerializer();
    const searchStrategy = searchStrategySerializer.validateDict(validatedConfig.tool_search_strategy as any) as ToolSearchStrategy;

    const variableSubstitutor = new DefaultVariableSubstitutor();

    const client = new UtcpClient(
      validatedConfig,
      variableSubstitutor,
      root_dir
    );
    const tempConfigWithoutOwnVars: UtcpClientConfig = { ...client.config, variables: {} };
    client.config.variables = await client.variableSubstitutor.substitute(client.config.variables, tempConfigWithoutOwnVars);

    // Register initial manuals specified in the config
    await client.registerManuals(client.config.manual_call_templates || []);

    return client;
  }

    /**
   * Retrieves a tool by its full namespaced name.
   * @param toolName The full namespaced name of the tool to retrieve.
   * @returns A Promise resolving to the tool if found, otherwise undefined.
   */
    public async getTool(toolName: string): Promise<Tool | undefined> {
      return this.config.tool_repository.getTool(toolName);
    }
  
    /**
     * Retrieves all tools from the repository.
     * @returns A Promise resolving to a list of all registered tools.
     */
    public async getTools(): Promise<Tool[]> {
      return this.config.tool_repository.getTools();
    }

  /**
   * Registers a single tool manual.
   * @param manualCallTemplate The call template describing how to discover and connect to the manual.
   * @returns A promise that resolves to a result object indicating success or failure.
   */
  public async registerManual(manualCallTemplate: CallTemplate): Promise<RegisterManualResult> {
    if (!manualCallTemplate.name) {
      manualCallTemplate.name = crypto.randomUUID();
    }
    manualCallTemplate.name = manualCallTemplate.name.replace(/[^\w]/g, '_');

    if (await this.config.tool_repository.getManual(manualCallTemplate.name)) {
      throw new Error(`Manual '${manualCallTemplate.name}' already registered. Please use a different name or deregister the existing manual.`);
    }

    const processedCallTemplate = await this.substituteCallTemplateVariables(manualCallTemplate, manualCallTemplate.name);

    const protocol = this._registeredCommProtocols.get(processedCallTemplate.call_template_type);
    if (!protocol) {
      throw new Error(`No communication protocol registered for type: '${processedCallTemplate.call_template_type}'`);
    }

    const result = await protocol.registerManual(this, processedCallTemplate);

    if (result.success) {
      for (const tool of result.manual.tools) {
        if (!tool.name.startsWith(`${processedCallTemplate.name}.`)) {
          tool.name = `${processedCallTemplate.name}.${tool.name}`;
        }
      }
      await this.config.tool_repository.saveManual(processedCallTemplate, result.manual);
      console.log(`Successfully registered manual '${manualCallTemplate.name}' with ${result.manual.tools.length} tools.`);
    } else {
      console.error(`Error registering manual '${manualCallTemplate.name}': ${result.errors.join(', ')}`);
    }

    return result;
  }

  /**
   * Registers a list of tool manuals in parallel.
   * @param manualCallTemplates An array of call templates to register.
   * @returns A promise that resolves to an array of registration results.
   */
  public async registerManuals(manualCallTemplates: CallTemplate[]): Promise<RegisterManualResult[]> {
    const registrationPromises = manualCallTemplates.map(async (template) => {
      try {
        return await this.registerManual(template);
      } catch (error: any) {
        console.error(`Error during batch registration for manual '${template.name}':`, error.message);
        return {
          manualCallTemplate: template,
          manual: UtcpManualSchema.parse({ tools: [] }),
          success: false,
          errors: [error.message],
        };
      }
    });
    return Promise.all(registrationPromises);
  }

  /**
   * Deregisters a tool manual and all of its associated tools.
   * @param manualName The name of the manual to deregister.
   * @returns A promise that resolves to true if the manual was found and removed, otherwise false.
   */
  public async deregisterManual(manualName: string): Promise<boolean> {
    const manualCallTemplate = await this.config.tool_repository.getManualCallTemplate(manualName);
    if (!manualCallTemplate) {
      console.warn(`Manual '${manualName}' not found for deregistration.`);
      return false;
    }

    const protocol = this._registeredCommProtocols.get(manualCallTemplate.call_template_type);
    if (protocol) {
      await protocol.deregisterManual(this, manualCallTemplate);
      console.log(`Deregistered communication protocol for manual '${manualName}'.`);
    } else {
      console.warn(`No communication protocol found for type '${manualCallTemplate.call_template_type}' of manual '${manualName}'.`);
    }

    const removed = await this.config.tool_repository.removeManual(manualName);
    if (removed) {
      console.log(`Successfully deregistered manual '${manualName}' from repository.`);
    } else {
      console.warn(`Manual '${manualName}' was not found in the repository during deregistration.`);
    }
    return removed;
  }

  /**
   * Calls a registered tool by its full namespaced name.
   * @param toolName The full name of the tool (e.g., 'my_manual.my_tool').
   * @param toolArgs A JSON object of arguments for the tool call.
   * @returns A promise that resolves to the result of the tool call, with post-processing applied.
   */
  public async callTool(toolName: string, toolArgs: Record<string, any>): Promise<any> {
    const manualName = toolName.split('.')[0];
    if (!manualName) {
      throw new Error(`Invalid tool name format for '${toolName}'. Expected 'manual_name.tool_name'.`);
    }

    const tool = await this.config.tool_repository.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in the repository.`);
    }
    const manualCallTemplate = await this.config.tool_repository.getManualCallTemplate(manualName);
    if (!manualCallTemplate) {
        throw new Error(`Could not find manual call template for manual '${manualName}'.`);
    }

    const processedToolCallTemplate = await this.substituteCallTemplateVariables(tool.tool_call_template, manualName);

    const protocol = this._registeredCommProtocols.get(processedToolCallTemplate.call_template_type);
    if (!protocol) {
      throw new Error(`No communication protocol registered for type: '${processedToolCallTemplate.call_template_type}'.`);
    }

    console.log(`Calling tool '${toolName}' via protocol '${processedToolCallTemplate.call_template_type}'.`);
    let result = await protocol.callTool(this, toolName, toolArgs, processedToolCallTemplate);
    
    // Apply post-processors
    for (const processor of this.postProcessors) {
        result = processor.postProcess(this, tool, manualCallTemplate, result);
    }
    
    return result;
  }

  /**
   * Calls a registered tool and streams the results.
   * @param toolName The full name of the tool (e.g., 'my_manual.my_tool').
   * @param toolArgs A JSON object of arguments for the tool call.
   * @returns An async generator that yields chunks of the tool's response, with post-processing applied to each chunk.
   */
  public async *callToolStreaming(toolName: string, toolArgs: Record<string, any>): AsyncGenerator<any, void, unknown> {
    const manualName = toolName.split('.')[0];
    if (!manualName) {
      throw new Error(`Invalid tool name format for '${toolName}'. Expected 'manual_name.tool_name'.`);
    }

    const tool = await this.config.tool_repository.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in the repository.`);
    }
    const manualCallTemplate = await this.config.tool_repository.getManualCallTemplate(manualName);
    if (!manualCallTemplate) {
        throw new Error(`Could not find manual call template for manual '${manualName}'.`);
    }

    const processedToolCallTemplate = await this.substituteCallTemplateVariables(tool.tool_call_template, manualName);

    const protocol = this._registeredCommProtocols.get(processedToolCallTemplate.call_template_type);
    if (!protocol) {
      throw new Error(`No communication protocol registered for type: '${processedToolCallTemplate.call_template_type}'.`);
    }

    console.log(`Calling tool '${toolName}' streamingly via protocol '${processedToolCallTemplate.call_template_type}'.`);
    for await (let chunk of protocol.callToolStreaming(this, toolName, toolArgs, processedToolCallTemplate)) {
      // Apply post-processors to each chunk
      for (const processor of this.postProcessors) {
        chunk = processor.postProcess(this, tool, manualCallTemplate, chunk);
      }
      yield chunk;
    }
  }

  /**
   * Searches for relevant tools based on a task description.
   * @param query A natural language description of the task.
   * @param limit The maximum number of tools to return.
   * @param anyOfTagsRequired An optional list of tags, where at least one must be present on a tool for it to be included.
   * @returns A promise that resolves to a list of relevant `Tool` objects.
   */
  public async searchTools(query: string, limit?: number, anyOfTagsRequired?: string[]): Promise<Tool[]> {
    console.log(`Searching for tools with query: '${query}'`);
    return this.config.tool_search_strategy.searchTools(this.config.tool_repository, query, limit, anyOfTagsRequired);
  }

  /**
   * Gets the required variables for a manual CallTemplate and its tools.
   *
   * @param manualCallTemplate The manual CallTemplate.
   * @returns A list of required variables for the manual CallTemplate and its tools.
   */
    public async getRequiredVariablesForManualAndTools(manualCallTemplate: CallTemplate): Promise<string[]> {
      const rawCallTemplate = manualCallTemplate as any;
      return this.variableSubstitutor.findRequiredVariables(rawCallTemplate, manualCallTemplate.name);
    }

  /**
   * Gets the required variables for a registered tool.
   *
   * @param toolName The name of a registered tool.
   * @returns A list of required variables for the tool.
   */
  public async getRequiredVariablesForRegisteredTool(toolName: string): Promise<string[]> {
    const manualName = toolName.split('.')[0];
    if (!manualName) {
      throw new Error(`Invalid tool name format for '${toolName}'. Expected 'manual_name.tool_name'.`);
    }

    const tool = await this.config.tool_repository.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in the repository.`);
    }

    return this.variableSubstitutor.findRequiredVariables(tool.tool_call_template, manualName);
  }

  /**
   * Substitutes variables in a given call template.
   * @param callTemplate The call template to process.
   * @param namespace An optional namespace for variable lookup.
   * @returns A new call template instance with all variables substituted.
   */
  public async substituteCallTemplateVariables<T extends CallTemplate>(callTemplate: T, namespace?: string): Promise<T> {
    // Use the variable substitutor to handle the replacement logic
    const rawSubstituted = await this.variableSubstitutor.substitute(callTemplate, this.config, namespace);

    const result = CallTemplateSchema.safeParse(rawSubstituted);

    if (!result.success) {
      console.error(`Zod validation failed for call template '${callTemplate.name}' after variable substitution.`, result.error.issues);
      throw new Error(`Invalid call template after variable substitution: ${result.error.message}`);
    }

    return result.data as T;
  }

  /**
   * Loads variables from sources defined in the client configuration.
   */
  private async loadVariables(): Promise<void> {
    for (const varLoader of this.config.load_variables_from || []) {
        const parsedLoader = varLoader;
        if (parsedLoader.variable_loader_type === 'dotenv') {
            try {
                const envFilePath = path.resolve(this.root_dir || process.cwd(), parsedLoader.env_file_path);
                const envContent = await fs.readFile(envFilePath, 'utf-8');
                const envVars = parseDotEnv(envContent);
                // Merge loaded variables, giving precedence to existing config.variables
                this.config.variables = { ...envVars, ...this.config.variables };
                console.log(`Loaded variables from .env file: ${envFilePath}`);
            } catch (e: any) {
                console.warn(`Could not load .env file from '${parsedLoader.env_file_path}': ${e.message}`);
            }
        }
    }
  }

  /**
   * Closes the UTCP client and releases any resources held by its communication protocols.
   */
  public async close(): Promise<void> {
    const closePromises: Promise<void>[] = [];
    for (const protocol of this._registeredCommProtocols.values()) {
      if (typeof protocol.close === 'function') {
        closePromises.push(protocol.close());
      }
    }
    await Promise.all(closePromises);
    console.log('UTCP Client and all registered protocols closed.');
  }
}