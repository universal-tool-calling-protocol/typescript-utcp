// packages/core/src/interfaces/variable_substitutor.ts
import { UtcpClientConfig } from '@utcp/core/client/utcp_client_config';

/**
 * Defines the contract for variable substitution implementations.
 * Implementations are responsible for replacing placeholders in configuration data
 * with actual values from various sources (e.g., config, environment variables).
 */
export interface VariableSubstitutor {
  /**
   * Recursively substitutes variables in the given object.
   *
   * @param obj The object (can be string, array, or object) containing potential variable references to substitute.
   * @param config The UTCP client configuration containing variable definitions and loaders.
   * @param namespace An optional namespace (e.g., manual name) to prefix variable lookups for isolation.
   * @returns The object with all variable references replaced by their values.
   * @throws UtcpVariableNotFoundError if a referenced variable cannot be resolved.
   */
  substitute<T>(obj: T, config: UtcpClientConfig, namespace?: string): Promise<T>;

  /**
   * Recursively finds all variable references in the given object.
   *
   * @param obj The object (can be string, array, or object) to scan for variable references.
   * @param namespace An optional namespace (e.g., manual name) to prefix variable lookups for isolation.
   * @returns A list of fully-qualified variable names found in the object.
   */
  findRequiredVariables(obj: any, namespace?: string): string[];
}