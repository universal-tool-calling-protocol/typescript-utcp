// packages/core/src/interfaces/tool_post_processor.ts
import { Tool } from '../data/tool';
import { CallTemplate } from '../data/call_template';
import { IUtcpClient } from './utcp_client_interface';
import { Serializer } from './serializer';
import z from 'zod';

/**
 * Defines the contract for tool post-processors that can modify the result of a tool call.
 * Implementations can apply transformations, filtering, or other logic to the raw tool output.
 * Post-processors are configured in the UtcpClientConfig and executed in order after a successful tool call.
 */
export interface ToolPostProcessor {
  /**
   * A string identifying the type of this tool post-processor (e.g., 'filter_dict', 'limit_strings').
   * This is used for configuration and plugin lookup.
   */
  tool_post_processor_type: string;

  /**
   * Processes the result of a tool call.
   *
   * @param caller The UTCP client instance that initiated the tool call.
   * @param tool The Tool object that was called.
   * @param manualCallTemplate The CallTemplateBase object of the manual that owns the tool.
   * @param result The raw result returned by the tool's communication protocol (can be a final result or a chunk from a stream).
   * @returns The processed result, which is then passed to the next processor in the chain or returned to the caller.
   */
  postProcess(caller: IUtcpClient, tool: Tool, manualCallTemplate: CallTemplate, result: any): any;
}

export class ToolPostProcessorConfigSerializer extends Serializer<ToolPostProcessor> {
  private static implementations: Record<string, Serializer<ToolPostProcessor>> = {};

  // No need for the whole plugin registry. Plugins just need to call this to register a new post-processor
  static registerPostProcessor(type: string, serializer: Serializer<ToolPostProcessor>, override = false): boolean {
    if (!override && ToolPostProcessorConfigSerializer.implementations[type]) {
      return false;
    }
    ToolPostProcessorConfigSerializer.implementations[type] = serializer;
    return true;
  }

  toDict(obj: ToolPostProcessor): Record<string, unknown> {
    const serializer = ToolPostProcessorConfigSerializer.implementations[obj.tool_post_processor_type];
    if (!serializer) throw new Error(`No serializer for type: ${obj.tool_post_processor_type}`);
    return serializer.toDict(obj);
  }

  validateDict(data: Record<string, unknown>): ToolPostProcessor {
    const serializer = ToolPostProcessorConfigSerializer.implementations[data["tool_post_processor_type"] as string];
    if (!serializer) throw new Error(`Invalid tool post-processor type: ${data["tool_post_processor_type"]}`);
    return serializer.validateDict(data);
  }
}

export const ToolPostProcessorSchema = z
  .custom<ToolPostProcessor>((obj) => {
    try {
      // Use the centralized serializer to validate & return the correct subtype
      const validated = new ToolPostProcessorConfigSerializer().validateDict(obj as Record<string, unknown>);
      return validated;
    } catch (e) {
      return false; // z.custom treats false as validation failure
    }
  }, {
    message: "Invalid ToolPostProcessor object",
  });