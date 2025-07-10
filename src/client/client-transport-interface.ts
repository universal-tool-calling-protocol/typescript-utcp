import { Tool } from '../shared/tool';
import { ProviderUnion } from '../shared/provider';

/**
 * Interface for client transport implementations
 */
export interface ClientTransportInterface {
  /**
   * Register a tool provider and discover its tools
   * @param manual_provider The provider to register
   * @returns List of discovered tools
   */
  register_tool_provider(manual_provider: ProviderUnion): Promise<Tool[]>;

  /**
   * Deregister a tool provider
   * @param manual_provider The provider to deregister
   */
  deregister_tool_provider(manual_provider: ProviderUnion): Promise<void>;

  /**
   * Call a tool with the given arguments
   * @param tool_name The name of the tool to call
   * @param args Arguments to pass to the tool
   * @param tool_provider The provider to use for the tool call
   * @returns The result of the tool call
   */
  call_tool(tool_name: string, args: Record<string, any>, tool_provider: ProviderUnion): Promise<any>;
}
