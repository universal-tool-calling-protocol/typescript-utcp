// Core Auth
import { AuthSerializer } from '../data/auth';
import { ApiKeyAuthSerializer } from '../data/auth_implementations/api_key_auth';
import { BasicAuthSerializer } from '../data/auth_implementations/basic_auth';
import { OAuth2AuthSerializer } from '../data/auth_implementations/oauth2_auth';
import { setPluginInitializer } from '../interfaces/serializer';

// Core Variable Loaders
import { VariableLoaderSerializer } from '../data/variable_loader';
import { DotEnvVariableLoaderSerializer } from '../data/variable_loader_implementations/dotenv_variable_loader';

// Core Tool Repository
import { InMemConcurrentToolRepositorySerializer } from '../implementations/in_mem_concurrent_tool_repository';
import { ConcurrentToolRepositoryConfigSerializer } from '../interfaces/concurrent_tool_repository';

// Core Search Strategy
import { TagSearchStrategyConfigSerializer } from '../implementations/tag_search_strategy';
import { ToolSearchStrategyConfigSerializer } from '../interfaces/tool_search_strategy';

// Core Post Processors
import { FilterDictPostProcessorSerializer } from '../implementations/post_processors/filter_dict_post_processor';
import { LimitStringsPostProcessorSerializer } from '../implementations/post_processors/limit_strings_post_processor';
import { ToolPostProcessorConfigSerializer } from '../interfaces/tool_post_processor';

let corePluginsInitialized = false;
let initializing = false;

// Register the initialization function with Serializer to break circular dependency
setPluginInitializer(() => ensureCorePluginsInitialized());

function _registerCorePlugins(): void {
  // Register Core Auth Serializers
  AuthSerializer.registerAuth('api_key', new ApiKeyAuthSerializer());
  AuthSerializer.registerAuth('basic', new BasicAuthSerializer());
  AuthSerializer.registerAuth('oauth2', new OAuth2AuthSerializer());

  // Register Core Variable Loader Serializers
  VariableLoaderSerializer.registerVariableLoader('dotenv', new DotEnvVariableLoaderSerializer());

  // Register Tool Repository Serializers
  ConcurrentToolRepositoryConfigSerializer.registerRepository('in_memory', new InMemConcurrentToolRepositorySerializer());

  // Register Tool Search Strategy Serializers
  ToolSearchStrategyConfigSerializer.registerStrategy('tag_and_description_word_match', new TagSearchStrategyConfigSerializer());
  
  // Register Tool Post-Processor Serializers
  ToolPostProcessorConfigSerializer.registerPostProcessor('filter_dict', new FilterDictPostProcessorSerializer());
  ToolPostProcessorConfigSerializer.registerPostProcessor('limit_strings', new LimitStringsPostProcessorSerializer());
}

/**
 * Attempts to auto-register optional UTCP plugins (HTTP, MCP, Text, Direct Call, CLI, etc.)
 * if they are available in the project. This is a best-effort approach that
 * silently ignores plugins that are not installed.
 */
function _tryRegisterOptionalPlugins(): void {
  // Try to register HTTP plugin
  try {
    const httpPlugin = require('@utcp/http');
    if (httpPlugin && typeof httpPlugin.register === 'function') {
      httpPlugin.register();
    }
  } catch (e) {
    // HTTP plugin not available, skip
  }

  // Try to register MCP plugin
  try {
    const mcpPlugin = require('@utcp/mcp');
    if (mcpPlugin && typeof mcpPlugin.register === 'function') {
      mcpPlugin.register();
    }
  } catch (e) {
    // MCP plugin not available, skip
  }

  // Try to register Text plugin
  try {
    const textPlugin = require('@utcp/text');
    if (textPlugin && typeof textPlugin.register === 'function') {
      textPlugin.register();
    }
  } catch (e) {
    // Text plugin not available, skip
  }

  // Try to register Direct Call plugin
  try {
    const directCallPlugin = require('@utcp/direct-call');
    if (directCallPlugin && typeof directCallPlugin.register === 'function') {
      directCallPlugin.register();
    }
  } catch (e) {
    // Direct Call plugin not available, skip
  }

  // Try to register CLI plugin
  try {
    const cliPlugin = require('@utcp/cli');
    if (cliPlugin && typeof cliPlugin.register === 'function') {
      cliPlugin.register();
    }
  } catch (e) {
    // CLI plugin not available, skip
  }
}

/**
 * Ensures that all core UTCP plugins (default repository, search strategy,
 * and post-processors) are registered with the plugin registry.
 * This function should be called once at application startup.
 */
export function ensureCorePluginsInitialized(): void {
  if (!corePluginsInitialized && !initializing) {
    initializing = true;
    _registerCorePlugins();
    _tryRegisterOptionalPlugins();
    corePluginsInitialized = true;
    initializing = false;
  }
}