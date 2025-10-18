// packages/core/src/data/auth.ts
import { z } from 'zod';
import { Serializer } from '../interfaces/serializer';

export interface Auth {
  /** Authentication type identifier */
  auth_type: string;
}

export class AuthSerializer extends Serializer<Auth> {
  private static serializers: Record<string, Serializer<Auth>> = {};

  // No need for the whole plugin registry. Plugins just need to call this to register a new auth type
  static registerAuth(
    authType: string,
    serializer: Serializer<Auth>,
    override = false
  ): boolean {
    if (!override && AuthSerializer.serializers[authType]) {
      return false;
    }
    AuthSerializer.serializers[authType] = serializer;
    return true;
  }

  toDict(obj: Auth): Record<string, unknown> {
    const serializer = AuthSerializer.serializers[obj.auth_type];
    if (!serializer) {
      throw new Error(`No serializer found for auth_type: ${obj.auth_type}`);
    }
    return serializer.toDict(obj);
  }

  validateDict(obj: Record<string, unknown>): Auth {
    const serializer = AuthSerializer.serializers[obj.auth_type as string];
    if (!serializer) {
      throw new Error(`Invalid auth_type: ${obj.auth_type}`);
    }
    return serializer.validateDict(obj);
  }
}

export const AuthSchema = z
  .custom<Auth>((obj) => {
    try {
      // Use the centralized serializer to validate & return the correct subtype
      const validated = new AuthSerializer().validateDict(obj as Record<string, unknown>);
      return validated;
    } catch (e) {
      return false; // z.custom treats false as validation failure
    }
  }, {
    message: "Invalid Auth object",
  });