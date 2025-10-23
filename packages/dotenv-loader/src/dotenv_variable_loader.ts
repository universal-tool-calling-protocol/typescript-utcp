// packages/dotenv-loader/src/dotenv_variable_loader.ts
import { z } from 'zod';
import { VariableLoader, Serializer } from '@utcp/sdk';
import { promises as fs } from 'fs';
import { parse as parseDotEnv } from 'dotenv';
import * as path from 'path';

/**
 * Configuration schema for DotEnv variable loader.
 * Loads variables from a .env file.
 */
const DotEnvVariableLoaderConfigSchema = z.object({
  variable_loader_type: z.literal('dotenv'),
  env_file_path: z.string().describe('Path to the .env file to load variables from.'),
}).passthrough();

type DotEnvVariableLoaderConfig = z.infer<typeof DotEnvVariableLoaderConfigSchema>;

/**
 * Variable loader that loads environment variables from a .env file.
 * The file is read on every get() call to support change detection.
 */
export class DotEnvVariableLoader implements VariableLoader {
  variable_loader_type: 'dotenv' = 'dotenv';
  env_file_path: string;

  constructor(env_file_path: string) {
    this.env_file_path = env_file_path;
  }

  /**
   * Retrieves a variable value from the .env file.
   * The file is read on every call to support runtime changes.
   * @param key Variable name to retrieve.
   * @returns Variable value if found, null otherwise.
   */
  async get(key: string): Promise<string | null> {
    try {
      const envFilePath = path.resolve(process.cwd(), this.env_file_path);
      const envContent = await fs.readFile(envFilePath, 'utf-8');
      const envVars = parseDotEnv(envContent);
      return envVars[key] ?? null;
    } catch (e: any) {
      // Silently return null if file doesn't exist or can't be read
      return null;
    }
  }
}

/**
 * Serializer for DotEnvVariableLoader objects.
 */
export class DotEnvVariableLoaderSerializer extends Serializer<DotEnvVariableLoader> {
  toDict(obj: DotEnvVariableLoader): Record<string, unknown> {
    return {
      variable_loader_type: obj.variable_loader_type,
      env_file_path: obj.env_file_path,
    };
  }

  validateDict(obj: Record<string, unknown>): DotEnvVariableLoader {
    try {
      const validated = new DotEnvVariableLoader(DotEnvVariableLoaderConfigSchema.parse(obj).env_file_path);
      return validated;
    } catch (e) {
      if (e instanceof z.ZodError) {
        throw new Error(`Invalid DotEnvVariableLoader configuration: ${e.message}`);
      }
      throw new Error("Unexpected error during validation");
    }
  }
}
