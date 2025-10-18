// packages/core/src/data/call_template.ts
import { z } from 'zod';
import { Auth, AuthSchema } from '@utcp/core/data/auth';
import { Serializer } from '../interfaces/serializer';

/**
 * Base interface for all CallTemplates. Each protocol plugin will implement this structure.
 * It provides the common fields every call template must have.
 */
export interface CallTemplate {
  /**
   * Unique identifier for the CallTemplate/Manual. Recommended to be a human-readable name.
   */
  name?: string;

  /**
   * The transport protocol type used by this call template (e.g., 'http', 'mcp', 'text').
   */
  call_template_type: string;

  /**
   * Optional authentication configuration for the provider.
   */
  auth?: Auth;

  [key: string]: any;
}

export class CallTemplateSerializer extends Serializer<CallTemplate> {
  private static serializers: Record<string, Serializer<CallTemplate>> = {};

  // No need for the whole plugin registry. Plugins just need to call this to register a new call template type
  static registerCallTemplate(
    callTemplateType: string,
    serializer: Serializer<CallTemplate>,
    override = false
  ): boolean {
    if (!override && CallTemplateSerializer.serializers[callTemplateType]) {
      return false;
    }
    CallTemplateSerializer.serializers[callTemplateType] = serializer;
    return true;
  }

  toDict(obj: CallTemplate): Record<string, unknown> {
    const serializer = CallTemplateSerializer.serializers[obj.call_template_type];
    if (!serializer) {
      throw new Error(`No serializer found for call_template_type: ${obj.call_template_type}`);
    }
    return serializer.toDict(obj);
  }

  validateDict(obj: Record<string, unknown>): CallTemplate {
    const serializer = CallTemplateSerializer.serializers[obj.call_template_type as string];
    if (!serializer) {
      throw new Error(`Invalid call_template_type: ${obj.call_template_type}`);
    }
    return serializer.validateDict(obj);
  }
}

export const CallTemplateSchema = z
  .custom<CallTemplate>((obj) => {
    try {
      // Use the centralized serializer to validate & return the correct subtype
      const validated = new CallTemplateSerializer().validateDict(obj as Record<string, unknown>);
      return validated;
    } catch (e) {
      return false; // z.custom treats false as validation failure
    }
  }, {
    message: "Invalid CallTemplate object",
  });