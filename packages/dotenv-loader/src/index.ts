/**
 * DotEnv Variable Loader plugin for UTCP.
 * Provides support for loading environment variables from .env files.
 */
// packages/dotenv-loader/src/index.ts
import { VariableLoaderSerializer, ensureCorePluginsInitialized } from '@utcp/sdk';
import { DotEnvVariableLoaderSerializer } from './dotenv_variable_loader';

/**
 * Registers the DotEnv Variable Loader with the UTCP plugin system.
 * This function is called automatically when the package is imported.
 * @param override Whether to override an existing registration
 */
export function register(override: boolean = false): void {
  // Ensure core plugins are initialized first
  ensureCorePluginsInitialized();
  
  // Register the DotEnv Variable Loader serializer
  VariableLoaderSerializer.registerVariableLoader('dotenv', new DotEnvVariableLoaderSerializer(), override);
}

// Automatically register DotEnv loader plugin on import
register();

// Export all public APIs
export * from './dotenv_variable_loader';
