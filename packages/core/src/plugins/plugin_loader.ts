// Core Auth
import { AuthSerializer } from '../data/auth';
import { ApiKeyAuthSerializer } from '../data/auth_implementations/api_key_auth';
import { BasicAuthSerializer } from '../data/auth_implementations/basic_auth';
import { OAuth2AuthSerializer } from '../data/auth_implementations/oauth2_auth';
import { setPluginInitializer } from '../interfaces/serializer';

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

  // Register Tool Repository Serializers
  ConcurrentToolRepositoryConfigSerializer.registerRepository('in_memory', new InMemConcurrentToolRepositorySerializer());

  // Register Tool Search Strategy Serializers
  ToolSearchStrategyConfigSerializer.registerStrategy('tag_and_description_word_match', new TagSearchStrategyConfigSerializer());
  
  // Register Tool Post-Processor Serializers
  ToolPostProcessorConfigSerializer.registerPostProcessor('filter_dict', new FilterDictPostProcessorSerializer());
  ToolPostProcessorConfigSerializer.registerPostProcessor('limit_strings', new LimitStringsPostProcessorSerializer());
}

/**
 * Ensures that all core UTCP plugins (auth serializers, default repository, 
 * search strategy, and post-processors) are registered with the plugin registry.
 * 
 * This function is called automatically when needed and should not be called manually.
 * 
 * Note: Optional plugins like HTTP, MCP, Text, File, etc. are NOT auto-registered.
 * Users must explicitly import the plugins they need:
 * 
 * @example
 * // Browser application
 * import { UtcpClient } from '@utcp/sdk';
 * import '@utcp/http';     // Auto-registers HTTP protocol
 * import '@utcp/text';     // Auto-registers text content protocol
 * 
 * @example
 * // Node.js application
 * import { UtcpClient } from '@utcp/sdk';
 * import '@utcp/http';
 * import '@utcp/mcp';
 * import '@utcp/file';
 * import '@utcp/dotenv-loader';
 */
export function ensureCorePluginsInitialized(): void {
  if (!corePluginsInitialized && !initializing) {
    initializing = true;
    _registerCorePlugins();
    corePluginsInitialized = true;
    initializing = false;
  }
}