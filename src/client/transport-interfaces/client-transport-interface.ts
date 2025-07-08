import { Tool } from '../../shared/tool';

/**
 * Interface for client transport implementations
 */
export interface ClientTransportInterface {
  /**
   * Call a tool with the given arguments
   * @param tool The tool to call
   * @param args Arguments to pass to the tool
   * @returns The result of the tool call
   */
  callTool(tool: Tool, args: Record<string, any>): Promise<any>;

  /**
   * Check if the transport can handle the given tool
   * @param tool The tool to check
   * @returns True if the transport can handle the tool
   */
  canHandle(tool: Tool): boolean;

  /**
   * Initialize the transport (if needed)
   */
  initialize?(): Promise<void>;

  /**
   * Cleanup the transport (if needed)
   */
  cleanup?(): Promise<void>;
}
