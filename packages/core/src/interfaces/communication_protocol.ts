// packages/core/src/interfaces/communication_protocol.ts
import { CallTemplate } from '@utcp/core/data/call_template';
import { RegisterManualResult } from '@utcp/core/data/register_manual_result';
import { IUtcpClient } from './utcp_client_interface';

/**
 * Abstract interface for UTCP client transport implementations (Communication Protocols).
 *
 * Defines the contract that all transport implementations must follow to
 * integrate with the UTCP client. Each transport handles communication
 * with a specific type of provider (HTTP, CLI, WebSocket, etc.).
 */
export abstract class CommunicationProtocol {

  /**
   * Mapping of communication protocol types to their respective implementations.
   */
  static communicationProtocols: { [type: string]: CommunicationProtocol } = {};

  /**
   * Registers a manual and its tools.
   *
   * Connects to the provider and retrieves the list of tools it offers.
   * This may involve making discovery requests, parsing configuration files,
   * or initializing connections depending on the provider type.
   *
   * @param caller The UTCP client that is calling this method. (Type will be properly defined in UtcpClient).
   * @param manualCallTemplate The call template of the manual to register.
   * @returns A RegisterManualResult object containing the call template and manual.
   */
  abstract registerManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<RegisterManualResult>;

  /**
   * Deregisters a manual and its tools.
   *
   * Cleanly disconnects from the provider and releases any associated
   * resources such as connections, processes, or file handles.
   *
   * @param caller The UTCP client that is calling this method.
   * @param manualCallTemplate The call template of the manual to deregister.
   */
  abstract deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void>;

  /**
   * Executes a tool call through this transport.
   *
   * Sends a tool invocation request to the provider using the appropriate
   * protocol and returns the result. Handles serialization of arguments
   * and deserialization of responses according to the transport type.
   *
   * @param caller The UTCP client that is calling this method.
   * @param toolName Name of the tool to call (may include provider prefix).
   * @param toolArgs Dictionary of arguments to pass to the tool.
   * @param toolCallTemplate Call template of the tool to call.
   * @returns The tool's response.
   */
  abstract callTool(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): Promise<any>;

  /**
   * Executes a tool call through this transport streamingly.
   *
   * Sends a tool invocation request to the provider using the appropriate
   * protocol and returns an async generator for streaming results.
   *
   * @param caller The UTCP client that is calling this method.
   * @param toolName Name of the tool to call.
   * @param toolArgs Arguments to pass to the tool.
   * @param toolCallTemplate Call template of the tool to call.
   * @returns An async generator that yields chunks of the tool's response.
   */
  abstract callToolStreaming(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): AsyncGenerator<any, void, unknown>;

  /**
   * Closes any persistent connections or resources held by the communication protocol.
   * This is a cleanup method that should be called when the client is shut down.
   */
  async close(): Promise<void> {}
}