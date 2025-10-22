// packages/direct-call/src/decorator.ts
import { CommunicationProtocol, ensureCorePluginsInitialized } from '@utcp/sdk';
import { DirectCommunicationProtocol, Callable } from './direct_communication_protocol';

/**
 * Get the singleton instance of DirectCommunicationProtocol from the registry.
 * If it doesn't exist, this will return undefined.
 */
function getDirectProtocol(): DirectCommunicationProtocol | undefined {
  ensureCorePluginsInitialized();
  const protocol = CommunicationProtocol.communicationProtocols['direct-call'];
  if (protocol && protocol instanceof DirectCommunicationProtocol) {
    return protocol;
  }
  return undefined;
}

/**
 * Register a function as a callable in the DirectCommunicationProtocol.
 * This function can be called at the global level with any function.
 * 
 * Note: The toolArgs object properties are spread as separate parameters when calling your function.
 * For example, if toolArgs is { name: 'Alice', age: 30 }, your function will be called with
 * callable('Alice', 30) - NOT callable({ name: 'Alice', age: 30 }).
 * 
 * @param callableName The name to register the function under.
 * @param callable The function to register.
 * 
 * @example
 * ```typescript
 * // Register a tool function with separate parameters
 * const myTool = addFunctionToUtcpDirectCall('myTool', async (message: string, count: number) => {
 *   return { result: message.repeat(count) };
 * });
 * 
 * // Or with a named function
 * async function greet(name: string) {
 *   return `Hello, ${name}!`;
 * }
 * addFunctionToUtcpDirectCall('greet', greet);
 * ```
 */
export function addFunctionToUtcpDirectCall<T extends Callable>(callableName: string, callable: T): T {
  const protocol = getDirectProtocol();
  if (protocol) {
    protocol.registerCallable(callableName, callable);
  } else {
    // If protocol isn't registered yet, queue it for registration
    // This will be handled when the protocol is initialized
    if (!pendingRegistrations.has(callableName)) {
      pendingRegistrations.set(callableName, callable);
    }
  }
  return callable;
}

/**
 * Queue of pending callable registrations.
 * These will be registered when the protocol is initialized.
 */
const pendingRegistrations = new Map<string, Callable>();

/**
 * Register all pending callables with the DirectCommunicationProtocol.
 * This is called automatically when the plugin is registered.
 */
export function registerPendingCallables(): void {
  const protocol = getDirectProtocol();
  if (protocol && pendingRegistrations.size > 0) {
    for (const [name, callable] of pendingRegistrations.entries()) {
      protocol.registerCallable(name, callable);
    }
    pendingRegistrations.clear();
  }
}

/**
 * Manually register a callable function.
 * This is an alternative to using addFunctionToUtcpDirectCall.
 * 
 * Note: The toolArgs object properties are spread as separate parameters when calling your function.
 * 
 * @param name The name to register the callable under.
 * @param callable The function to register.
 * 
 * @example
 * ```typescript
 * registerCallable('myTool', async (message: string, value: number) => {
 *   return { result: `${message}: ${value}` };
 * });
 * ```
 */
export function registerCallable(name: string, callable: Callable): void {
  const protocol = getDirectProtocol();
  if (protocol) {
    protocol.registerCallable(name, callable);
  } else {
    throw new Error('DirectCommunicationProtocol is not registered. Did you import @utcp/direct-call?');
  }
}

/**
 * Manually unregister a callable function.
 * 
 * @param name The name of the callable to unregister.
 * 
 * @example
 * ```typescript
 * unregisterCallable('myTool');
 * ```
 */
export function unregisterCallable(name: string): void {
  const protocol = getDirectProtocol();
  if (protocol) {
    protocol.unregisterCallable(name);
  } else {
    throw new Error('DirectCommunicationProtocol is not registered. Did you import @utcp/direct-call?');
  }
}
