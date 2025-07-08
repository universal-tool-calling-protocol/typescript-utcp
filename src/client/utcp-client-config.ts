import { z } from 'zod';

// Configuration schema for UTCP client
export const UtcpClientConfigSchema = z.object({
  providers_file_path: z.string().optional(),
  providers: z.array(z.any()).optional(),
  tool_repository_type: z.enum(['in_memory']).default('in_memory'),
  search_strategy: z.enum(['tag']).default('tag'),
  max_concurrent_calls: z.number().positive().default(10),
  default_timeout: z.number().default(30000),
  retry_attempts: z.number().default(3),
  retry_delay: z.number().default(1000),
});

export type UtcpClientConfig = z.infer<typeof UtcpClientConfigSchema>;

// Custom error for variable not found
export class UtcpVariableNotFound extends Error {
  constructor(variableName: string) {
    super(`UTCP variable not found: ${variableName}`);
    this.name = 'UtcpVariableNotFound';
  }
}

// Utility function to resolve environment variables in config
export function resolveConfigVariables(config: any): any {
  if (typeof config === 'string') {
    // Replace ${VAR_NAME} with environment variable value
    return config.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new UtcpVariableNotFound(varName);
      }
      return value;
    });
  }
  
  if (Array.isArray(config)) {
    return config.map(item => resolveConfigVariables(item));
  }
  
  if (typeof config === 'object' && config !== null) {
    const resolved: any = {};
    for (const [key, value] of Object.entries(config)) {
      resolved[key] = resolveConfigVariables(value);
    }
    return resolved;
  }
  
  return config;
}
