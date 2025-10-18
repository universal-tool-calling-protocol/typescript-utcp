// packages/core/src/implementations/default_variable_substitutor.ts
import { UtcpClientConfig } from '@utcp/core/client/utcp_client_config';
import { VariableSubstitutor } from '@utcp/core/interfaces/variable_substitutor';
import { UtcpVariableNotFoundError } from '../exceptions/utcp_variable_not_found_error';

/**
 * Default implementation of the VariableSubstitutor interface.
 * Provides a hierarchical variable resolution system that searches for
 * variables in the following order:
 * 1. Configuration variables (exact match from config.variables)
 * 2. Custom variable loaders (in order, from config.load_variables_from)
 * 3. Environment variables (process.env)
 *
 * It supports variable placeholders using ${VAR_NAME} or $VAR_NAME syntax
 * and applies namespacing (e.g., manual__name__VAR_NAME) for isolation,
 * mirroring the Python UTCP SDK's convention.
 */
export class DefaultVariableSubstitutor implements VariableSubstitutor {

  /**
   * Retrieves a variable value from configured sources, respecting namespaces.
   * 
   * @param key The variable name to look up (without namespace prefix).
   * @param config The UTCP client configuration.
   * @param namespace An optional namespace to prepend to the variable name for lookup.
   * @returns The resolved variable value.
   * @throws UtcpVariableNotFoundError if the variable cannot be found.
   */
  private async _getVariable(key: string, config: UtcpClientConfig, namespace?: string): Promise<string> {
    // Apply namespacing: namespace.replace("_", "!").replace("!", "__") + "_" + key
    let effectiveKey = key;
    if (namespace) {
      effectiveKey = namespace.replace(/_/g, '!').replace(/!/g, '__') + '_' + key;
    }

    // --- Search Hierarchy ---

    // 1. Check config.variables (highest precedence)
    if (config.variables && config.variables[effectiveKey]) {
      return config.variables[effectiveKey];
    }

    // 2. Check custom variable loaders (in order)
    if (config.load_variables_from) {
      for (const varLoader of config.load_variables_from) {
        const varValue = await varLoader.get(effectiveKey);
        if (varValue) {
          return varValue;
        }
      }
    }

    // 3. Check environment variables (lowest precedence)
    try {
      const envVar = process.env[effectiveKey];
      if (envVar) {
        return envVar;
      }
    } catch (e) {
      // Ignore environment variable access errors
    }

    throw new UtcpVariableNotFoundError(effectiveKey);
  }

  /**
   * Recursively substitutes variables in the given object.
   * 
   * @param obj The object (can be string, array, or object) containing potential variable references to substitute.
   * @param config The UTCP client configuration containing variable definitions and loaders.
   * @param namespace An optional namespace (e.g., manual name) to prefix variable lookups for isolation.
   * @returns The object with all variable references replaced by their values.
   * @throws UtcpVariableNotFoundError if a referenced variable cannot be resolved.
   */
  public async substitute<T>(obj: T, config: UtcpClientConfig, namespace?: string): Promise<T> {
    if (namespace && !/^[a-zA-Z0-9_]+$/.test(namespace)) {
      throw new Error(`Variable namespace '${namespace}' contains invalid characters. Only alphanumeric characters and underscores are allowed.`);
    }

    if (typeof obj === 'string') {
      let currentString: string = obj;
      const regex = /\$\{([a-zA-Z0-9_]+)\}|\$([a-zA-Z0-9_]+)/g;
      let match: RegExpExecArray | null;
      let lastIndex = 0;
      const parts: string[] = [];

      regex.lastIndex = 0;

      while ((match = regex.exec(currentString)) !== null) {
        const varNameInTemplate = match[1] || match[2];
        const fullMatch = match[0];

        parts.push(currentString.substring(lastIndex, match.index));

        try {
          const replacement = await this._getVariable(varNameInTemplate, config, namespace);
          parts.push(replacement);
        } catch (error: any) {
          if (error instanceof UtcpVariableNotFoundError) {
            throw new UtcpVariableNotFoundError(error.variableName);
          }
          throw error;
        }

        lastIndex = match.index + fullMatch.length;
      }
      parts.push(currentString.substring(lastIndex));

      return parts.join('') as T;
    }

    if (Array.isArray(obj)) {
      return Promise.all(obj.map(item => this.substitute(item, config, namespace))) as Promise<T>;
    }

    if (obj !== null && typeof obj === 'object') {
      const newObj: { [key: string]: any } = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          newObj[key] = await this.substitute((obj as any)[key], config, namespace);
        }
      }
      return newObj as T;
    }

    return obj;
  }

  /**
   * Recursively finds all variable references in the given object.
   *
   * @param obj The object (can be string, array, or object) to scan for variable references.
   * @param namespace An optional namespace (e.g., manual name) to prefix variable lookups for isolation.
   * @returns A list of fully-qualified variable names found in the object.
   */
  public findRequiredVariables(obj: any, namespace?: string): string[] {
    if (namespace && !/^[a-zA-Z0-9_]+$/.test(namespace)) {
      throw new Error(`Variable namespace '${namespace}' contains invalid characters. Only alphanumeric characters and underscores are allowed.`);
    }

    const variables: string[] = [];
    const regex = /\$\{([a-zA-Z0-9_]+)\}|\$([a-zA-Z0-9_]+)/g;

    if (typeof obj === 'string') {
      let match;
      while ((match = regex.exec(obj)) !== null) {
        const varNameInTemplate = match[1] || match[2];
        
        // Apply Python SDK's double underscore namespacing:
        const effectiveNamespace = namespace ? namespace.replace(/_/g, '__') : undefined;
        const prefixedVarName = effectiveNamespace ? `${effectiveNamespace}__${varNameInTemplate}` : varNameInTemplate;
        
        variables.push(prefixedVarName);
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        variables.push(...this.findRequiredVariables(item, namespace));
      }
    } else if (obj !== null && typeof obj === 'object') {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          variables.push(...this.findRequiredVariables(obj[key], namespace));
        }
      }
    }

    return Array.from(new Set(variables));
  }
}