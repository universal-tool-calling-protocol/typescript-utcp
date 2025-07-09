import { z } from 'zod';

/**
 * Custom error for when a variable referenced in a provider configuration is not found.
 */
export class UtcpVariableNotFoundError extends Error {
  public variableName: string;

  constructor(variableName: string) {
    super(
      `Variable ${variableName} referenced in provider configuration not found. Please add it to the environment variables or to your UTCP configuration.`,
    );
    this.variableName = variableName;
    this.name = 'UtcpVariableNotFoundError';
  }
}

// Schema for the dotenv variable source
const UtcpDotEnvSchema = z.object({
  type: z.literal('dotenv'),
  env_file_path: z.string(),
});

/**
 * Represents a source for loading variables, like a .env file.
 */
export const UtcpVariablesConfigSchema = z.discriminatedUnion('type', [
  UtcpDotEnvSchema,
  // Future variable source types can be added here
]);

/**
 * The main configuration schema for the UTCP client.
 */
export const UtcpClientConfigSchema = z.object({
  /**
   * A dictionary of variables that can be referenced in provider configurations.
   */
  variables: z.record(z.string()).optional().default({}),
  /**
   * The file path to a JSON or YAML file containing a list of providers.
   */
  providers_file_path: z.string().optional(),
  /**
   * A list of sources from which to load additional variables.
   */
  load_variables_from: z.array(UtcpVariablesConfigSchema).optional(),
});

/**
 * TypeScript type for the UTCP client configuration.
 */
export type UtcpClientConfig = z.infer<typeof UtcpClientConfigSchema>;

/**
 * TypeScript type for a variable configuration source.
 */
export type UtcpVariablesConfig = z.infer<typeof UtcpVariablesConfigSchema>;
