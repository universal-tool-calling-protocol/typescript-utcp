/**
 * Direct call communication protocol for UTCP client.
 *
 * This protocol allows direct invocation of JavaScript/TypeScript functions
 * as UTCP tools without the need for external APIs or file-based configurations.
 */
// packages/direct-call/src/direct_communication_protocol.ts
import { 
  CommunicationProtocol, 
  RegisterManualResult, 
  CallTemplate, 
  UtcpManual, 
  UtcpManualSerializer,
  IUtcpClient 
} from '@utcp/sdk';
import { DirectCallTemplate, DirectCallTemplateSchema } from './direct_call_template';

/**
 * Type definition for callable functions.
 * Callables can be sync or async functions that accept arguments and return any value.
 */
export type Callable = (...args: any[]) => any | Promise<any>;

/**
 * Communication protocol for direct callable functions.
 */
export class DirectCommunicationProtocol implements CommunicationProtocol {
  /**
   * Map of callable functions indexed by their callable_name.
   */
  private callables: Map<string, Callable> = new Map();

  private _log_info(message: string): void {
    console.log(`[DirectCommunicationProtocol] ${message}`);
  }

  private _log_error(message: string): void {
    console.error(`[DirectCommunicationProtocol Error] ${message}`);
  }

  /**
   * Register a callable function.
   * 
   * @param name The name to register the callable under.
   * @param callable The function to register.
   */
  public registerCallable(name: string, callable: Callable): void {
    this.callables.set(name, callable);
    this._log_info(`Registered callable: ${name}`);
  }

  /**
   * Unregister a callable function.
   * 
   * @param name The name of the callable to unregister.
   */
  public unregisterCallable(name: string): void {
    this.callables.delete(name);
    this._log_info(`Unregistered callable: ${name}`);
  }

  /**
   * Get a callable function by name.
   * 
   * @param name The name of the callable to retrieve.
   * @returns The callable function or undefined if not found.
   */
  public getCallable(name: string): Callable | undefined {
    return this.callables.get(name);
  }

  /**
   * Register a manual by calling the specified callable and expecting a UtcpManual as return.
   */
  public async registerManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<RegisterManualResult> {
    if (!(manualCallTemplate as any).callable_name) {
      throw new Error('DirectCommunicationProtocol requires a DirectCallTemplate');
    }

    const directCallTemplate = DirectCallTemplateSchema.parse(manualCallTemplate);
    const callableName = directCallTemplate.callable_name;

    this._log_info(`Registering manual from callable '${callableName}'`);

    try {
      const callable = this.callables.get(callableName);
      if (!callable) {
        throw new Error(`Callable '${callableName}' not found. Did you register it?`);
      }

      // Call the callable and expect a UtcpManual as return
      const result = await Promise.resolve(callable());
      
      // Validate that the result is a valid UtcpManual
      const utcpManual = new UtcpManualSerializer().validateDict(result);

      this._log_info(`Loaded ${utcpManual.tools.length} tools from callable '${callableName}'`);
      return {
        manualCallTemplate,
        manual: utcpManual,
        success: true,
        errors: [],
      };
    } catch (error: any) {
      this._log_error(`Failed to register manual from callable '${callableName}': ${error.stack || error.message}`);
      return {
        manualCallTemplate,
        manual: new UtcpManualSerializer().validateDict({ tools: [] }),
        success: false,
        errors: [error.stack || error.message],
      };
    }
  }

  /**
   * Deregister a manual (no-op for direct calls).
   */
  public async deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void> {
    this._log_info(`Deregistering manual '${manualCallTemplate.name}' (no-op)`);
  }

  /**
   * Call a tool by invoking the specified callable with the provided arguments.
   */
  public async callTool(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): Promise<any> {
    if (!(toolCallTemplate as any).callable_name) {
      throw new Error('DirectCommunicationProtocol requires a DirectCallTemplate for tool calls');
    }

    const directCallTemplate = DirectCallTemplateSchema.parse(toolCallTemplate);
    const callableName = directCallTemplate.callable_name;

    this._log_info(`Calling tool '${toolName}' via callable '${callableName}'`);

    try {
      const callable = this.callables.get(callableName);
      if (!callable) {
        throw new Error(`Callable '${callableName}' not found for tool '${toolName}'`);
      }

      // Call the callable with the tool arguments spread as separate parameters
      const result = await Promise.resolve(callable(...Object.values(toolArgs)));
      return result;
    } catch (error: any) {
      this._log_error(`Failed to call tool '${toolName}' via callable '${callableName}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Streaming variant: calls the callable and yields the result.
   * If the callable returns an async generator, yields each chunk.
   * Otherwise, yields the full result as a single chunk.
   */
  public async *callToolStreaming(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): AsyncGenerator<any, void, unknown> {
    if (!(toolCallTemplate as any).callable_name) {
      throw new Error('DirectCommunicationProtocol requires a DirectCallTemplate for tool calls');
    }

    const directCallTemplate = DirectCallTemplateSchema.parse(toolCallTemplate);
    const callableName = directCallTemplate.callable_name;

    this._log_info(`Calling tool '${toolName}' (streaming) via callable '${callableName}'`);

    try {
      const callable = this.callables.get(callableName);
      if (!callable) {
        throw new Error(`Callable '${callableName}' not found for tool '${toolName}'`);
      }

      // Call the callable with the tool arguments spread as separate parameters
      const result = await Promise.resolve(callable(...Object.values(toolArgs)));

      // Check if the result is an async generator
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        // Yield each chunk from the async generator
        for await (const chunk of result) {
          yield chunk;
        }
      } else {
        // Yield the full result as a single chunk
        yield result;
      }
    } catch (error: any) {
      this._log_error(`Failed to call tool '${toolName}' (streaming) via callable '${callableName}': ${error.message}`);
      throw error;
    }
  }

  public async close(): Promise<void> {
    this._log_info('Direct Call Communication Protocol closed.');
    this.callables.clear();
  }
}
