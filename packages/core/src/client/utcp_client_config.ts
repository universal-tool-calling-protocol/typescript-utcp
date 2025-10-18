// packages/core/src/client/utcp_client_config.ts
import { z } from 'zod';
import { ensureCorePluginsInitialized } from '../plugins/plugin_loader';
import { CallTemplate, CallTemplateSchema, CallTemplateSerializer } from '@utcp/core/data/call_template';
import { ToolSearchStrategy, ToolSearchStrategyConfigSerializer } from '../interfaces/tool_search_strategy';
import { VariableLoader, VariableLoaderSchema, VariableLoaderSerializer } from '@utcp/core/data/variable_loader';
import { ConcurrentToolRepository, ConcurrentToolRepositoryConfigSerializer } from '@utcp/core/interfaces/concurrent_tool_repository';
import { ToolPostProcessor, ToolPostProcessorConfigSerializer } from '@utcp/core/interfaces/tool_post_processor';
import { Serializer } from '../interfaces/serializer';

// Ensure core plugins are initialized before this module uses any serializers
ensureCorePluginsInitialized();

/**
 * REQUIRED
 * Configuration model for UTCP client setup.
 *
 * Provides comprehensive configuration options for UTCP clients including
 * variable definitions, provider file locations, and variable loading
 * mechanisms. Supports hierarchical variable resolution with multiple
 * sources.
 *
 * Variable Resolution Order:
 *     1. Direct variables dictionary
 *     2. Custom variable loaders (in order)
 *     3. Environment variables
 *
 * Attributes:
 *     variables: A dictionary of directly-defined
 *         variables for substitution.
 *     load_variables_from: A list of
 *         variable loader configurations for loading variables from external
 *         sources like .env files or remote services.
 *     tool_repository: Configuration for the tool
 *         repository, which manages the storage and retrieval of tools.
 *         Defaults to an in-memory repository.
 *     tool_search_strategy: Configuration for the tool
 *         search strategy, defining how tools are looked up. Defaults to a
 *         tag and description-based search.
 *     post_processing: A list of tool post-processor
 *         configurations to be applied after a tool call.
 *     manual_call_templates: A list of manually defined
 *         call templates for registering tools that don't have a provider.
 *
 * Example:
 *     ```typescript
 *     const config: UtcpClientConfig = {
 *         variables: {"MANUAL__NAME_API_KEY_NAME": "$REMAPPED_API_KEY"},
 *         load_variables_from: [
 *             new VariableLoaderSerializer().validateDict({"variable_loader_type": "dotenv", "env_file_path": ".env"})
 *         ],
 *         tool_repository: new ConcurrentToolRepositoryConfigSerializer().validateDict({
 *             "tool_repository_type": "in_memory"
 *         }),
 *         tool_search_strategy: new ToolSearchStrategyConfigSerializer().validateDict({
 *             "tool_search_strategy_type": "tag_and_description_word_match"
 *         }),
 *         post_processing: [],
 *         manual_call_templates: []
 *     };
 *     ```
 */
export interface UtcpClientConfig {
  /**
   * A dictionary of directly-defined variables for substitution.
   */
  variables: Record<string, string>;

  /**
   * A list of variable loader configurations for loading variables from external
   * sources like .env files. Loaders are processed in order.
   */
  load_variables_from: VariableLoader[] | null;

  /**
   * Configuration for the tool repository.
   * Defaults to an in-memory repository.
   */
  tool_repository: ConcurrentToolRepository;

  /**
   * Configuration for the tool search strategy.
   * Defaults to a tag and description-based search.
   */
  tool_search_strategy: ToolSearchStrategy;

  /**
   * A list of tool post-processor configurations to be applied after a tool call.
   */
  post_processing: ToolPostProcessor[];

  /**
   * A list of manually defined call templates for registering tools at client initialization.
   */
  manual_call_templates: CallTemplate[];
}

/**
 * The main configuration schema for the UTCP client.
 */
export const UtcpClientConfigSchema = z.object({
  variables: z.record(z.string(), z.string()).optional().default({}),
  
  load_variables_from: z.array(VariableLoaderSchema).nullable().optional().default(null)
    .transform((val) => {
      if (val === null) return null;
      return val.map(item => {
        if ('variable_loader_type' in item) {
          return new VariableLoaderSerializer().validateDict(item as Record<string, unknown>);
        }
        return item as VariableLoader;
      });
    }),
  
  tool_repository: z.any()
    .transform((val) => {
      if (typeof val === 'object' && val !== null && 'tool_repository_type' in val) {
        return new ConcurrentToolRepositoryConfigSerializer().validateDict(val as Record<string, unknown>);
      }
      return val as ConcurrentToolRepository;
    })
    .optional()
    .default(new ConcurrentToolRepositoryConfigSerializer().validateDict({
      tool_repository_type: ConcurrentToolRepositoryConfigSerializer.default_strategy,
    })),

  tool_search_strategy: z.any()
    .transform((val) => {
      if (typeof val === 'object' && val !== null && 'tool_search_strategy_type' in val) {
        return new ToolSearchStrategyConfigSerializer().validateDict(val as Record<string, unknown>);
      }
      return val as ToolSearchStrategy;
    })
    .optional()
    .default(new ToolSearchStrategyConfigSerializer().validateDict({
      tool_search_strategy_type: ToolSearchStrategyConfigSerializer.default_strategy,
    })),

  post_processing: z.array(z.any())
    .transform((val) => {
      return val.map(item => {
        if (typeof item === 'object' && item !== null && 'tool_post_processor_type' in item) {
          return new ToolPostProcessorConfigSerializer().validateDict(item as Record<string, unknown>);
        }
        return item as ToolPostProcessor;
      });
    })
    .optional()
    .default([]),

  manual_call_templates: z.array(CallTemplateSchema)
    .transform((val) => {
      return val.map(item => {
        if (typeof item === 'object' && item !== null && 'call_template_type' in item) {
          return new CallTemplateSerializer().validateDict(item as Record<string, unknown>);
        }
        return item as CallTemplate;
      });
    })
    .optional()
    .default([]),
}).strict();

/**
 * REQUIRED
 * Serializer for UTCP client configurations.
 *
 * Defines the contract for serializers that convert UTCP client configurations to and from
 * dictionaries for storage or transmission. Serializers are responsible for:
 * - Converting UTCP client configurations to dictionaries for storage or transmission
 * - Converting dictionaries back to UTCP client configurations
 * - Ensuring data consistency during serialization and deserialization
 */
export class UtcpClientConfigSerializer extends Serializer<UtcpClientConfig> {
  /**
   * REQUIRED
   * Convert a UtcpClientConfig object to a dictionary.
   *
   * @param obj The UtcpClientConfig object to convert.
   * @returns The dictionary converted from the UtcpClientConfig object.
   */
  toDict(obj: UtcpClientConfig): Record<string, unknown> {
    return {
      variables: obj.variables,
      load_variables_from: obj.load_variables_from === null ? null : 
        obj.load_variables_from?.map(item => new VariableLoaderSerializer().toDict(item)),
      tool_repository: new ConcurrentToolRepositoryConfigSerializer().toDict(obj.tool_repository),
      tool_search_strategy: new ToolSearchStrategyConfigSerializer().toDict(obj.tool_search_strategy),
      post_processing: obj.post_processing.map(item => new ToolPostProcessorConfigSerializer().toDict(item)),
      manual_call_templates: obj.manual_call_templates.map(item => new CallTemplateSerializer().toDict(item)),
    };
  }
  
  /**
   * REQUIRED
   * Validate a dictionary and convert it to a UtcpClientConfig object.
   *
   * @param data The dictionary to validate and convert.
   * @returns The UtcpClientConfig object converted from the dictionary.
   * @throws Error if validation fails
   */
  validateDict(data: Record<string, unknown>): UtcpClientConfig {
    try {
      return UtcpClientConfigSchema.parse(data) as UtcpClientConfig;
    } catch (e: any) {
      throw new Error(`Invalid UtcpClientConfig: ${e.message}\n${e.stack || ''}`);
    }
  }
}