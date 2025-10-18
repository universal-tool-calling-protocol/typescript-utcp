// packages/core/src/data/variable_loader.ts
import { z } from 'zod';
import { Serializer } from '../interfaces/serializer';

/**
 * Base interface for all VariableLoaders.
 * Variable loaders are responsible for loading configuration variables from external sources.
 */
export interface VariableLoader {
  /**
   * The type identifier for this variable loader (e.g., 'dotenv').
   */
  variable_loader_type: string;

  [key: string]: any;

    /**
     * Retrieves a variable value by key.
     * @abstract
     * @param key Variable name to retrieve.
     * @returns Variable value if found, None otherwise.
     */
    get(key: string): Promise<string | null>;
}

/**
 * Serializer for VariableLoader objects.
 * Uses a registry pattern to delegate to type-specific serializers.
 */
export class VariableLoaderSerializer extends Serializer<VariableLoader> {
  private static serializers: Record<string, Serializer<VariableLoader>> = {};

  /**
   * Registers a variable loader serializer for a specific type.
   * @param type The variable_loader_type identifier
   * @param serializer The serializer instance for this type
   * @param override Whether to override an existing registration
   * @returns true if registration succeeded, false if already exists and override is false
   */
  static registerVariableLoader(
    type: string,
    serializer: Serializer<VariableLoader>,
    override = false
  ): boolean {
    if (!override && VariableLoaderSerializer.serializers[type]) {
      return false;
    }
    VariableLoaderSerializer.serializers[type] = serializer;
    return true;
  }

  toDict(obj: VariableLoader): Record<string, unknown> {
    const serializer = VariableLoaderSerializer.serializers[obj.variable_loader_type];
    if (!serializer) {
      throw new Error(`No serializer found for variable_loader_type: ${obj.variable_loader_type}`);
    }
    return serializer.toDict(obj);
  }

  validateDict(obj: Record<string, unknown>): VariableLoader {
    const serializer = VariableLoaderSerializer.serializers[obj.variable_loader_type as string];
    if (!serializer) {
      throw new Error(`Invalid variable_loader_type: ${obj.variable_loader_type}`);
    }
    return serializer.validateDict(obj);
  }
}

/**
 * Zod schema for VariableLoader using custom validation.
 */
export const VariableLoaderSchema = z
  .custom<VariableLoader>((obj) => {
    try {
      const validated = new VariableLoaderSerializer().validateDict(obj as Record<string, unknown>);
      return validated;
    } catch (e) {
      return false;
    }
  }, {
    message: "Invalid VariableLoader object",
  });
