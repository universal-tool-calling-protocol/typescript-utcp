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
import { CommunicationProtocol, UtcpManualSchema, UtcpManualSerializer } from '@utcp/sdk';
import { RegisterManualResult } from '@utcp/sdk';
import { CallTemplate } from '@utcp/sdk';
import { UtcpManual } from '@utcp/sdk';
import { Tool } from '@utcp/sdk';
import { IUtcpClient } from '@utcp/sdk';
import { CliCallTemplate, CliCallTemplateSchema, CommandStep } from './cli_call_template';
import { spawn, ChildProcess } from 'child_process';
import { clearTimeout } from 'timers';
import { Readable } from 'stream';
import { randomBytes } from 'crypto';

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
   * Default set of host environment variables propagated to the CLI
   * subprocess when `CliCallTemplate.inherit_env_vars` is not provided
   * (i.e. undefined / null). Locating binaries (`PATH` / `PATHEXT`),
   * basic shell + locale state, and Windows runtime paths are needed for
   * almost any tool to start. Anything else (cloud creds, API keys,
   * internal tokens) must be opted in by listing the variable name in
   * `inherit_env_vars`, or its value provided in `env_vars`.
   *
   * If `inherit_env_vars === []`, the caller is opting into strict mode
   * and NOTHING is inherited from the host -- only `env_vars` reaches
   * the subprocess.
   *
   * Backs GHSA-r8j5-8747-88cm (sister advisory of python-utcp's
   * GHSA-5v57-8rxj-3p2r): the previous implementation handed the full
   * `process.env` to the subprocess, which combined with the command
   * injection in `_substitute_utcp_args` let an attacker exfiltrate
   * every secret in the host process.
   */
  private static readonly _DEFAULT_INHERITED_KEYS_UNIX: readonly string[] = [
    'PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'LOGNAME',
    'SHELL', 'TZ', 'TERM',
  ];
  private static readonly _DEFAULT_INHERITED_KEYS_WINDOWS: readonly string[] = [
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC',
    'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME',
    'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
    'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'OS',
    'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS',
  ];

  private _default_inherited_keys(): readonly string[] {
    return process.platform === 'win32'
      ? CliCommunicationProtocol._DEFAULT_INHERITED_KEYS_WINDOWS
      : CliCommunicationProtocol._DEFAULT_INHERITED_KEYS_UNIX;
  }

  /**
   * Prepare environment variables for command execution.
   *
   * Composes the subprocess environment with one layer of host
   * inheritance (controlled by `provider.inherit_env_vars`) plus
   * `provider.env_vars` on top:
   *
   *   - `inherit_env_vars` undefined / null (default): pass through the
   *     built-in default allowlist of host vars (`PATH`, `HOME` /
   *     `PATHEXT`, `SYSTEMROOT`, etc.) so normal shells and binaries
   *     work without extra wiring.
   *   - `inherit_env_vars === []`: strict mode. Nothing from the host
   *     environment reaches the subprocess -- only `env_vars`.
   *   - `inherit_env_vars === [...]`: pass through exactly the named
   *     host variables. The default allowlist is NOT merged in, so
   *     callers who still want `PATH` must include it explicitly.
   *
   * `env_vars` is always applied last and overrides anything inherited
   * from the host.
   *
   * @param provider The CLI provider
   * @returns Environment variables dictionary
   */
  private _prepare_environment(provider: CliCallTemplate): Record<string, string> {
    const inheritedKeys: readonly string[] =
      provider.inherit_env_vars === undefined || provider.inherit_env_vars === null
        ? this._default_inherited_keys()
        : provider.inherit_env_vars;

    const env: Record<string, string> = {};
    for (const key of inheritedKeys) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // Caller-supplied variables override anything inherited from the
    // host. Skip undefined values so they don't appear as the literal
    // string "undefined" in the subprocess.
    if (provider.env_vars) {
      for (const [k, v] of Object.entries(provider.env_vars)) {
        if (v !== undefined && v !== null) {
          env[k] = String(v);
        }
      }
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
      // IMPORTANT: do NOT merge `process.env` here. `_prepare_environment`
      // is responsible for assembling the subprocess environment with the
      // proper allowlist + caller-supplied overrides. Re-adding the full
      // host environment at this layer would silently undo the
      // restriction and re-introduce GHSA-r8j5-8747-88cm-style leaks.
      childProcess = spawn(shell, args, {
        cwd: options.cwd,
        env: options.env,
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
   * Generate an unguessable nonce that namespaces the env vars used for
   * argument substitution within a single tool invocation. Prevents a
   * template author from being able to write a literal
   * `${__UTCP_ARG_<nonce>_<name>}` reference that collides with our
   * substitution slot, which would re-introduce
   * unquoted-variable-expansion injection.
   */
  private static _make_nonce(): string {
    return randomBytes(8).toString('hex');
  }

  /**
   * Compute the env-var name that carries one substituted tool_arg
   * value into the subprocess. The nonce is fresh per invocation so
   * `${__UTCP_ARG_<nonce>_<name>}` literals cannot exist in templates
   * authored before invocation time.
   */
  private static _env_var_name(nonce: string, argName: string): string {
    return `__UTCP_ARG_${nonce}_${argName}`;
  }

  /**
   * Substitute `UTCP_ARG_<name>_UTCP_END` placeholders in a command
   * string by emitting context-appropriate shell variable references
   * and recording the actual values as env vars on the returned object.
   * The caller wires those env vars into the subprocess (alongside the
   * call template's `env_vars` and host-inheritance allowlist) so the
   * shell expands them at runtime, AFTER it has already parsed the
   * script. As a result, attacker-controlled `toolArgs` never get
   * spliced into the script source and therefore cannot inject
   * commands or escape any quoting context.
   *
   * Quote-state tracking ensures the emitted reference is correct for
   * its surrounding context:
   *
   *   bash (Unix):
   *     - bare:                   `"$VAR"`        (quoted: no word splitting)
   *     - inside double quotes:   `${VAR}`        (bash expands inside dq)
   *     - inside single quotes:   `'"$VAR"'`      (close sq, dq with var,
   *                                                reopen sq -- bash treats
   *                                                adjacent quoted regions
   *                                                as a single token)
   *
   *   powershell (Windows):
   *     - bare:                   `$env:VAR`
   *     - inside double quotes:   `$env:VAR`      (PS expands inside dq)
   *     - inside single quotes:   error -- PS does not expand inside
   *                                        single-quoted strings, so
   *                                        we cannot safely substitute
   *                                        without rewriting the entire
   *                                        surrounding token. Author
   *                                        must use a double-quoted
   *                                        string.
   *
   * Backs the sister advisory of python-utcp's GHSA-33p6-5jxp-p3x4.
   * An earlier fix that did inline `shlex.quote`-style substitution was
   * still vulnerable when the placeholder sat inside a surrounding `"`
   * region: e.g. template `curl "https://api/UTCP_ARG_id_UTCP_END"`
   * with `id = '"; rm -rf /; "'` produced
   * `curl "https://api/'"; rm -rf /; "'"`, where bash's parser closed
   * the outer dq early and ran the injected commands.
   *
   * @param command  Command string containing UTCP_ARG_<name>_UTCP_END placeholders
   * @param toolArgs Dictionary of argument names and values
   * @param nonce    Per-invocation nonce used to namespace generated env vars
   * @returns        { command, env } where `command` is safe to embed in a
   *                 shell script and `env` is the additional env vars the
   *                 subprocess must receive for the references to expand.
   */
  private _substitute_utcp_args(
    command: string,
    toolArgs: Record<string, any>,
    nonce: string,
  ): { command: string; env: Record<string, string> } {
    return process.platform === 'win32'
      ? this._substitute_powershell(command, toolArgs, nonce)
      : this._substitute_bash(command, toolArgs, nonce);
  }

  private _substitute_bash(
    command: string,
    toolArgs: Record<string, any>,
    nonce: string,
  ): { command: string; env: Record<string, string> } {
    const env: Record<string, string> = {};
    const out: string[] = [];
    const phRe = /^UTCP_ARG_([a-zA-Z0-9_]+?)_UTCP_END/;
    let state: 'normal' | 'dq' | 'sq' = 'normal';
    let i = 0;

    const collect = (name: string): string => {
      const v = CliCommunicationProtocol._env_var_name(nonce, name);
      if (name in toolArgs) {
        env[v] = String(toolArgs[name]);
      } else {
        this._log_error(`Missing argument '${name}' for placeholder in command: ${command}`);
        env[v] = `MISSING_ARG_${name}`;
      }
      return v;
    };

    while (i < command.length) {
      const m = command.slice(i).match(phRe);
      if (m) {
        const v = collect(m[1]);
        if (state === 'normal') {
          out.push(`"$${v}"`);
        } else if (state === 'dq') {
          out.push(`\${${v}}`);
        } else {
          // sq: break out, dq the var, reopen sq. Adjacent quoted
          // regions concatenate into one token.
          out.push(`'"$${v}"'`);
        }
        i += m[0].length;
        continue;
      }

      const ch = command[i];
      if (state === 'normal') {
        if (ch === "'") {
          state = 'sq';
          out.push(ch);
        } else if (ch === '"') {
          state = 'dq';
          out.push(ch);
        } else if (ch === '\\' && i + 1 < command.length) {
          out.push(ch);
          out.push(command[i + 1]);
          i += 2;
          continue;
        } else {
          out.push(ch);
        }
      } else if (state === 'dq') {
        if (ch === '\\' && i + 1 < command.length && '"\\$`\n'.includes(command[i + 1])) {
          out.push(ch);
          out.push(command[i + 1]);
          i += 2;
          continue;
        }
        if (ch === '"') {
          state = 'normal';
          out.push(ch);
        } else {
          out.push(ch);
        }
      } else {
        // sq: only `'` ends the string. No expansion, no escapes.
        if (ch === "'") {
          state = 'normal';
          out.push(ch);
        } else {
          out.push(ch);
        }
      }
      i++;
    }

    return { command: out.join(''), env };
  }

  private _substitute_powershell(
    command: string,
    toolArgs: Record<string, any>,
    nonce: string,
  ): { command: string; env: Record<string, string> } {
    const env: Record<string, string> = {};
    const out: string[] = [];
    const phRe = /^UTCP_ARG_([a-zA-Z0-9_]+?)_UTCP_END/;
    let state: 'normal' | 'dq' | 'sq' = 'normal';
    let i = 0;

    const collect = (name: string): string => {
      const v = CliCommunicationProtocol._env_var_name(nonce, name);
      if (name in toolArgs) {
        env[v] = String(toolArgs[name]);
      } else {
        this._log_error(`Missing argument '${name}' for placeholder in command: ${command}`);
        env[v] = `MISSING_ARG_${name}`;
      }
      return v;
    };

    while (i < command.length) {
      const m = command.slice(i).match(phRe);
      if (m) {
        if (state === 'sq') {
          throw new Error(
            `Placeholder UTCP_ARG_${m[1]}_UTCP_END appears inside a ` +
              `PowerShell single-quoted string in command: ${command}\n` +
              `PowerShell does not expand variables inside single quotes, ` +
              `so this cannot be substituted safely. Use a double-quoted ` +
              `string ("...") around the placeholder instead.`,
          );
        }
        const v = collect(m[1]);
        // Both bare and dq accept `$env:VAR` -- PowerShell expands it
        // inside double-quoted strings.
        out.push(`$env:${v}`);
        i += m[0].length;
        continue;
      }

      const ch = command[i];
      if (state === 'normal') {
        if (ch === "'") {
          state = 'sq';
          out.push(ch);
        } else if (ch === '"') {
          state = 'dq';
          out.push(ch);
        } else if (ch === '`' && i + 1 < command.length) {
          out.push(ch);
          out.push(command[i + 1]);
          i += 2;
          continue;
        } else {
          out.push(ch);
        }
      } else if (state === 'dq') {
        if (ch === '`' && i + 1 < command.length) {
          out.push(ch);
          out.push(command[i + 1]);
          i += 2;
          continue;
        }
        if (ch === '"') {
          state = 'normal';
          out.push(ch);
        } else {
          out.push(ch);
        }
      } else {
        // PS sq: `''` is an escaped single quote inside the literal.
        if (ch === "'" && i + 1 < command.length && command[i + 1] === "'") {
          out.push(ch);
          out.push(command[i + 1]);
          i += 2;
          continue;
        }
        if (ch === "'") {
          state = 'normal';
          out.push(ch);
        } else {
          out.push(ch);
        }
      }
      i++;
    }

    return { command: out.join(''), env };
  }
  
  /**
   * Build a combined shell script from multiple commands.
   *
   * Returns both the script and the env-var contributions accumulated
   * across all command steps. Callers must merge these env vars into
   * the subprocess environment so the placeholder references the
   * script writes (`$VAR` / `${VAR}` / `$env:VAR`) actually resolve to
   * the original tool_arg values at runtime.
   *
   * @param commands List of CommandStep objects to combine
   * @param toolArgs Tool arguments for placeholder substitution
   * @returns        { script, env } — script is the shell script source,
   *                 env is the additional UTCP_ARG_* env vars to inject.
   */
  private _build_combined_shell_script(
    commands: CommandStep[],
    toolArgs: Record<string, any>,
  ): { script: string; env: Record<string, string> } {
    const isWindows = process.platform === 'win32';
    const scriptLines: string[] = [];
    const accumulatedEnv: Record<string, string> = {};
    // One nonce per script -- shared across all command steps so the
    // env-var contributions land in a consistent namespace.
    const nonce = CliCommunicationProtocol._make_nonce();

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
      // Substitute UTCP_ARG placeholders -- emits shell-variable
      // references, contributes the actual values via env.
      const { command: substitutedCommand, env: stepEnv } = this._substitute_utcp_args(
        commandStep.command,
        toolArgs,
        nonce,
      );
      Object.assign(accumulatedEnv, stepEnv);

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

    return { script: scriptLines.join('\n'), env: accumulatedEnv };
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
      const baseEnv = this._prepare_environment(cliCallTemplate);
      const { script: shellScript, env: argEnv } = this._build_combined_shell_script(
        cliCallTemplate.commands,
        {},
      );
      // Per-call UTCP_ARG_* env vars carry placeholder values; layer them
      // on top of the inherited+caller-supplied env so the references
      // emitted into the script actually resolve.
      const env = { ...baseEnv, ...argEnv };

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
      const baseEnv = this._prepare_environment(cliCallTemplate);

      // Build combined shell script with output capture. The script's
      // placeholders are emitted as `$VAR` / `${VAR}` / `$env:VAR`
      // references; the actual tool_arg values come back as `argEnv`.
      const { script: shellScript, env: argEnv } = this._build_combined_shell_script(
        cliCallTemplate.commands,
        toolArgs,
      );
      const env = { ...baseEnv, ...argEnv };

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