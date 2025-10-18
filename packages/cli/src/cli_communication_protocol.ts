/**
 * Command Line Interface (CLI) communication protocol for the UTCP client.
 *
 * This module provides an implementation of the `CommunicationProtocol` interface
 * that enables the UTCP client to interact with command-line tools. It supports
 * discovering tools by executing a command and parsing its output for a UTCP
 * manual, as well as calling those tools with arguments.
 *
 * Key Features:
 *     - Asynchronous execution of shell commands.
 *     - Tool discovery by running a command that outputs a UTCP manual.
 *     - Flexible argument formatting for different CLI conventions.
 *     - Support for environment variables and custom working directories.
 *     - Cross-platform command parsing for Windows and Unix-like systems.
 *
 * Security Considerations:
 *     Executing arbitrary command-line tools can be dangerous. This protocol
 *     should only be used with trusted tools.
 */
// packages/cli/src/cli_communication_protocol.ts
import { CommunicationProtocol } from '@utcp/core/interfaces/communication_protocol';
import { RegisterManualResult } from '@utcp/core/data/register_manual_result';
import { CallTemplate, CallTemplateSerializer } from '@utcp/core/data/call_template';
import { UtcpManual, UtcpManualSerializer, UtcpManualSchema } from '@utcp/core/data/utcp_manual';
import { Tool } from '@utcp/core/data/tool';
import { IUtcpClient } from '@utcp/core/interfaces/utcp_client_interface';
import { CliCallTemplate, CliCallTemplateSerializer, CommandStep, CliCallTemplateSchema } from '@utcp/cli/cli_call_template';
import { spawn, ChildProcess } from 'child_process';
import { clearTimeout } from 'timers';
import { Readable } from 'stream';

/**
 * REQUIRED
 * Communication protocol for interacting with CLI-based tool providers.
 *
 * This class implements the `CommunicationProtocol` interface to handle
 * communication with command-line tools. It discovers tools by executing a
 * command specified in a `CliCallTemplate` and parsing the output for a UTCP
 * manual. It also executes tool calls by running the corresponding command
 * with the provided arguments.
 */
export class CliCommunicationProtocol implements CommunicationProtocol {
  /**
   * Log informational messages.
   */
  private _log_info(message: string): void {
    console.log(`[CliCommunicationProtocol] ${message}`);
  }

  /**
   * Log error messages.
   */
  private _log_error(message: string): void {
    console.error(`[CliCommunicationProtocol Error] ${message}`);
  }

  /**
   * Prepare environment variables for command execution.
   * 
   * @param provider The CLI provider
   * @returns Environment variables dictionary
   */
  private _prepare_environment(provider: CliCallTemplate): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    
    // Add custom environment variables if provided
    if (provider.env_vars) {
      Object.assign(env, provider.env_vars);
    }
    
    return env;
  }

  private async _executeShellScript(
    script: string,
    options: { cwd?: string; env?: Record<string, string> } = {},
    timeoutMs: number = 60000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/bash';
    const args = isWindows ? ['-NoProfile', '-Command', script] : ['-c', script];
    
    let childProcess: ChildProcess | undefined;

    try {
      const currentProcessEnv = typeof process !== 'undefined' ? process.env : {};
      const mergedEnv = { ...currentProcessEnv, ...options.env };

      childProcess = spawn(shell, args, {
        cwd: options.cwd,
        env: mergedEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const readStream = async (stream: Readable | null): Promise<string> => {
        if (!stream) return '';
        let buffer = '';
        for await (const chunk of stream) {
          buffer += chunk.toString();
        }
        return buffer;
      };

      const stdoutPromise = readStream(childProcess.stdout);
      const stderrPromise = readStream(childProcess.stderr);
      const exitCodePromise = new Promise<number | null>((resolve) => {
        childProcess?.on('close', (code) => resolve(code));
        childProcess?.on('error', () => resolve(1));
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
          childProcess?.kill();
          reject(new Error(`Command script timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
        childProcess?.on('close', () => clearTimeout(id));
      });

      const [stdout, stderr, exitCode] = await Promise.race([
        Promise.all([stdoutPromise, stderrPromise, exitCodePromise]),
        timeoutPromise,
      ]);

      return { stdout, stderr, exitCode };
    } catch (e: any) {
      childProcess?.kill();
      this._log_error(`Error executing shell script: ${e}`);
      throw e;
    }
  }

  /**
   * Substitute UTCP_ARG placeholders in command string with tool arguments.
   * 
   * @param command Command string containing UTCP_ARG_argname_UTCP_END placeholders
   * @param toolArgs Dictionary of argument names and values
   * @returns Command string with placeholders replaced by actual values
   */
  private _substitute_utcp_args(command: string, toolArgs: Record<string, any>): string {
    const pattern = /UTCP_ARG_([a-zA-Z0-9_]+?)_UTCP_END/g;
    return command.replace(pattern, (match, argName) => {
      if (argName in toolArgs) {
        // Return the raw value. The shell will handle it correctly when it's inside quotes
        // in the final command (e.g., echo "Initial message: Workflow Argument").
        return String(toolArgs[argName]);
      }
      this._log_error(`Missing argument '${argName}' for placeholder in command: ${command}`);
      return `MISSING_ARG_${argName}`;
    });
  }
  
  /**
   * Build a combined shell script from multiple commands.
   * 
   * @param commands List of CommandStep objects to combine
   * @param toolArgs Tool arguments for placeholder substitution
   * @returns Shell script string that executes all commands in sequence
   */
  private _build_combined_shell_script(commands: CommandStep[], toolArgs: Record<string, any>): string {
    const isWindows = process.platform === 'win32';
    const scriptLines: string[] = [];

    // Add error handling and setup
    if (isWindows) {
      // PowerShell script
      scriptLines.push('$ErrorActionPreference = "Stop"');  // Exit on error
      scriptLines.push('# Variables to store command outputs');
    } else {
      // Unix shell script
      scriptLines.push('#!/bin/bash');
      // Don't use set -e to allow error output capture and processing
      scriptLines.push('# Variables to store command outputs');
    }

    // Execute each command and store output in variables
    for (let i = 0; i < commands.length; i++) {
      const commandStep = commands[i];
      // Substitute UTCP_ARG placeholders
      const substitutedCommand = this._substitute_utcp_args(commandStep.command, toolArgs);
      
      const varName = `CMD_${i}_OUTPUT`;
      
      if (isWindows) {
        // PowerShell - capture command output in variable
        scriptLines.push(`\$${varName} = ${substitutedCommand} 2>&1 | Out-String`);
      } else {
        // Unix shell - capture command output in variable
        scriptLines.push(`${varName}=$(${substitutedCommand} 2>&1)`);
      }
    }

    // Echo only the outputs we want based on append_to_final_output
    for (let i = 0; i < commands.length; i++) {
      const commandStep = commands[i];
      const isLastCommand = i === commands.length - 1;
      let shouldAppend = commandStep.append_to_final_output;
      
      if (shouldAppend === null || shouldAppend === undefined) {
        // Default: only append the last command's output
        shouldAppend = isLastCommand;
      }
      
      if (shouldAppend) {
        const varName = `CMD_${i}_OUTPUT`;
        if (isWindows) {
          // PowerShell
          scriptLines.push(`Write-Output \$${varName}`);
        } else {
          // Unix shell
          scriptLines.push(`echo "\${${varName}}"`);
        }
      }
    }

    return scriptLines.join('\n');
  }

  /**
   * REQUIRED
   * Registers a CLI-based manual and discovers its tools.
   *
   * This method executes the command specified in the `CliCallTemplate`'s
   * commands. It then attempts to parse the command's output (stdout) as a
   * UTCP manual in JSON format.
   *
   * @param caller The UTCP client instance that is calling this method.
   * @param manualCallTemplate The `CliCallTemplate` containing the details for
   *     tool discovery, such as the command to run.
   * @returns A `RegisterManualResult` object indicating whether the registration
   *     was successful and containing the discovered tools.
   * @throws Error if the `manualCallTemplate` is not an instance of
   *     `CliCallTemplate` or if commands are not set.
   */
  public async registerManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<RegisterManualResult> {
    if (!(manualCallTemplate as any).commands || (manualCallTemplate as any).commands.length === 0) {
      throw new Error(`CliCallTemplate '${manualCallTemplate.name}' must have at least one command`);
    }

    const cliCallTemplate = CliCallTemplateSchema.parse(manualCallTemplate);
    this._log_info(`Registering CLI manual '${manualCallTemplate.name}' with ${cliCallTemplate.commands.length} command(s)`);

    try {
      // Execute commands using the same approach as call_tool but with no arguments
      const env = this._prepare_environment(cliCallTemplate);
      const shellScript = this._build_combined_shell_script(cliCallTemplate.commands, {});
      
      this._log_info(`Executing shell script for tool discovery from provider '${manualCallTemplate.name}'`);

      const { stdout, stderr, exitCode } = await this._executeShellScript(shellScript, {
        cwd: cliCallTemplate.working_dir || undefined,
        env,
      }, 30000);

      // Get output based on exit code
      const output = exitCode === 0 ? stdout : stderr;

      if (!output.trim()) {
        this._log_info(`No output from commands for CLI provider '${manualCallTemplate.name}'`);
        return {
          success: false,
          manualCallTemplate,
          manual: new UtcpManualSerializer().validateDict({ tools: [] }),
          errors: [`No output from discovery commands for CLI provider '${manualCallTemplate.name}'`],
        };
      }

      // Try to parse UTCP manual from the output
      try {
        const utcpManual = UtcpManualSchema.parse(JSON.parse(output.trim()));
        this._log_info(`Discovered ${utcpManual.tools.length} tools from CLI provider '${manualCallTemplate.name}'`);
        return {
          success: true,
          manualCallTemplate,
          manual: utcpManual,
          errors: [],
        };
      } catch (parseError: any) {
        const errorMsg = `Could not parse UTCP manual from CLI provider '${manualCallTemplate.name}' output: ${parseError.message}`;
        this._log_error(errorMsg);
        return {
          success: false,
          manualCallTemplate,
          manual: new UtcpManualSerializer().validateDict({ tools: [] }),
          errors: [errorMsg],
        };
      }
    } catch (e: any) {
      const errorMsg = `Error discovering tools from CLI provider '${manualCallTemplate.name}': ${e.message || e}`;
      this._log_error(errorMsg);
      return {
        success: false,
        manualCallTemplate,
        manual: new UtcpManualSerializer().validateDict({ tools: [] }),
        errors: [errorMsg],
      };
    }
  }

  /**
   * REQUIRED
   * Deregisters a CLI manual.
   *
   * For the CLI protocol, this is a no-op as there are no persistent
   * connections to terminate.
   *
   * @param caller The UTCP client instance that is calling this method.
   * @param manualCallTemplate The call template of the manual to deregister.
   */
  public async deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void> {
    this._log_info(`Deregistering CLI manual '${manualCallTemplate.name}' (no-op)`);
  }

  /**
   * REQUIRED
   * Calls a CLI tool by executing its command.
   *
   * This method constructs and executes the command specified in the
   * `CliCallTemplate`. It formats the provided `tool_args` as command-line
   * arguments and runs the command in a subprocess.
   *
   * @param caller The UTCP client instance that is calling this method.
   * @param toolName The name of the tool to call.
   * @param toolArgs A dictionary of arguments for the tool call.
   * @param toolCallTemplate The `CliCallTemplate` for the tool.
   * @returns The result of the command execution. If the command exits with a code
   *     of 0, it returns the content of stdout. If the exit code is non-zero,
   *     it returns the content of stderr.
   * @throws Error if `toolCallTemplate` is not an instance of
   *     `CliCallTemplate` or if commands are not set.
   */
  public async callTool(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): Promise<any> {
    if (!(toolCallTemplate as any).commands || (toolCallTemplate as any).commands.length === 0) {
      throw new Error(`CliCallTemplate '${toolCallTemplate.name}' must have at least one command`);
    }

    const cliCallTemplate = CliCallTemplateSchema.parse(toolCallTemplate);
    this._log_info(`Executing CLI tool '${toolName}' with ${cliCallTemplate.commands.length} command(s) in single subprocess`);
    
    try {
      const env = this._prepare_environment(cliCallTemplate);
      
      // Build combined shell script with output capture
      const shellScript = this._build_combined_shell_script(cliCallTemplate.commands, toolArgs);
      
      this._log_info('Executing combined shell script');
      
      // Execute the combined script in a single subprocess
      const { stdout, stderr, exitCode } = await this._executeShellScript(shellScript, {
        cwd: cliCallTemplate.working_dir || undefined,
        env,
      }, 120000);  // Longer timeout for multi-command execution
      
      // Platform-specific output handling
      const isWindows = process.platform === 'win32';
      let output: string;
      
      if (isWindows) {
        // Windows (PowerShell): Use stdout on success, stderr on failure
        output = exitCode === 0 ? stdout : stderr;
      } else {
        // Unix (Bash): Our script captures everything and echoes to stdout
        // So we always use stdout first, fallback to stderr if stdout is empty
        output = stdout.trim() ? stdout : stderr;
      }
      
      if (!output.trim()) {
        this._log_info(`CLI tool '${toolName}' produced no output`);
        return '';
      }
      
      // With the variable approach, output is already filtered - just return it
      output = output.trim();
      
      // Try to parse as JSON if it looks like JSON
      if (output.startsWith('{') || output.startsWith('[')) {
        try {
          const result = JSON.parse(output);
          this._log_info(`Returning JSON output from CLI tool '${toolName}'`);
          return result;
        } catch {
          // Not valid JSON, continue to return as text
        }
      }
      
      this._log_info(`Returning text output from CLI tool '${toolName}'`);
      return output;
    } catch (e: any) {
      this._log_error(`Error executing CLI tool '${toolName}': ${e.message || e}`);
      throw e;
    }
  }

  /**
   * REQUIRED
   * Streaming calls are not supported for the CLI protocol.
   *
   * @throws Error Always, as this functionality is not supported.
   */
  public async *callToolStreaming(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): AsyncGenerator<any, void, unknown> {
    throw new Error('Streaming is not supported by the CLI communication protocol.');
  }

  public async close(): Promise<void> {
    this._log_info('CLI Communication Protocol closed (no-op).');
  }
}