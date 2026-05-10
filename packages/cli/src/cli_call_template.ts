// packages/cli/src/cli_call_template.ts
import { z } from 'zod';
import { CallTemplate } from '@utcp/sdk';
import { Serializer } from '@utcp/sdk';

/**
 * REQUIRED
 * Configuration for a single command step in a CLI execution flow.
 *
 * Attributes:
 *     command: The command string to execute. Can contain UTCP_ARG_argname_UTCP_END
 *         placeholders that will be replaced with values from tool_args. Can also
 *         reference previous command outputs using $CMD_0_OUTPUT, $CMD_1_OUTPUT, etc.
 *
 *         Placeholders are NOT inlined as text. Instead the protocol
 *         emits a context-aware shell variable reference (`"$VAR"` /
 *         `${VAR}` / `$env:VAR`) and ships the actual `tool_args` value
 *         to the subprocess via an environment variable, so the shell
 *         expands the value AFTER it has parsed the script. Attacker-
 *         controlled bytes therefore cannot inject commands or escape
 *         any quoting context.
 *
 *         A placeholder always substitutes a **single logical value**
 *         (never a list of shell words) -- the substituted value cannot
 *         be reinterpreted as additional shell syntax. Several
 *         placeholders may appear within the same quoted region (e.g.
 *         `"https://api/UTCP_ARG_id_UTCP_END/UTCP_ARG_action_UTCP_END"`)
 *         and they compose with the surrounding literal text into one
 *         shell argument. Tools that previously relied on a single
 *         placeholder splitting into multiple flags (e.g.
 *         `UTCP_ARG_flags_UTCP_END` -> `--verbose --debug`) must now
 *         use one placeholder per intended flag. This change ships
 *         with @utcp/cli 1.1.1.
 *
 *         PowerShell limitation: a placeholder appearing inside a
 *         single-quoted PowerShell string (`'...'`) will throw at
 *         script-build time -- PowerShell does not expand variables
 *         inside single quotes, and rewriting the surrounding token
 *         is too brittle. Use a double-quoted string ("...") instead.
 *     append_to_final_output: Whether this command's output should be included
 *         in the final result. If not specified, defaults to False for all
 *         commands except the last one.
 *
 * Examples:
 *     Basic command step:
 *     ```json
 *     {
 *       "command": "git status",
 *       "append_to_final_output": true
 *     }
 *     ```
 *
 *     Command with argument placeholders and output reference:
 *     ```json
 *     {
 *       "command": "echo \"Cloning to: UTCP_ARG_target_dir_UTCP_END, previous status: $CMD_0_OUTPUT\"",
 *       "append_to_final_output": true
 *     }
 *     ```
 */
export interface CommandStep {
  /**
   * Command string to execute, may contain UTCP_ARG_argname_UTCP_END
   * placeholders. Each placeholder substitutes a single value via a
   * shell-variable reference whose form is chosen for the surrounding
   * quote context; substituted values cannot be reinterpreted as
   * additional shell syntax. Several placeholders may appear in the
   * same quoted region and compose into one argument.
   */
  command: string;
  /**
   * Whether to include this command's output in final result. Defaults to False for all except last command
   */
  append_to_final_output?: boolean | null;
}

/**
 * Zod schema for CommandStep.
 */
export const CommandStepSchema: z.ZodType<CommandStep> = z.object({
  command: z
    .string()
    .describe(
      'Command string to execute, may contain UTCP_ARG_argname_UTCP_END ' +
        'placeholders. Each placeholder substitutes a single value via a ' +
        'shell-variable reference chosen for its surrounding quote ' +
        'context; substituted values cannot be reinterpreted as ' +
        'additional shell syntax. Several placeholders may appear in ' +
        'the same quoted region and compose into one argument.',
    ),
  append_to_final_output: z.boolean().nullable().optional().describe('Whether to include this command\'s output in final result. Defaults to False for all except last command'),
}).strict() as z.ZodType<CommandStep>;

/**
 * REQUIRED
 * Call template configuration for Command Line Interface (CLI) tools.
 *
 * This class defines the configuration for executing command-line tools and
 * programs as UTCP tool providers. Commands are executed in a single subprocess
 * to maintain state (like directory changes) between commands.
 *
 * **Cross-Platform Script Generation:**
 * - **Windows**: Commands are converted to a PowerShell script
 * - **Unix/Linux/macOS**: Commands are converted to a Bash script
 * 
 * **Command Syntax Requirements:**
 * - Windows: Use PowerShell syntax (e.g., `Get-ChildItem`, `Set-Location`)
 * - Unix: Use Bash/shell syntax (e.g., `ls`, `cd`)
 * 
 * **Referencing Previous Command Output:**
 * You can reference the output of previous commands using variables:
 * - **PowerShell**: `$CMD_0_OUTPUT`, `$CMD_1_OUTPUT`, etc.
 * - **Bash**: `$CMD_0_OUTPUT`, `$CMD_1_OUTPUT`, etc.
 * 
 * Example: `echo "Previous result: $CMD_0_OUTPUT"`
 *
 * **Argument Substitution (@utcp/cli >= 1.1.1):**
 * `UTCP_ARG_argname_UTCP_END` placeholders are replaced with a
 * context-aware shell variable reference (`"$VAR"` outside quotes,
 * `${VAR}` inside double quotes, an adjacent-quote concat trick inside
 * single-quoted bash). The actual `tool_args` value is shipped to the
 * subprocess via a fresh, per-invocation env var; the shell expands it
 * at runtime AFTER it has parsed the script, so attacker-controlled
 * bytes cannot inject commands or escape any quoting context.
 *
 * A placeholder always substitutes a single logical value (never a
 * list of shell words). Several placeholders may appear in one quoted
 * region and compose with the surrounding text into one argument
 * (e.g. `"https://api/UTCP_ARG_id_UTCP_END/UTCP_ARG_action_UTCP_END"`).
 * If a tool needs multiple separate flags, use one placeholder per
 * flag in bare position. PowerShell single-quoted strings cannot
 * expand variables, so a placeholder inside `'...'` on Windows raises
 * a build-time error; use a double-quoted string instead.
 *
 * **Subprocess Environment (@utcp/cli >= 1.1.1):**
 * The CLI subprocess no longer inherits the full host environment.
 * Inheritance is controlled by `inherit_env_vars`:
 *   - Omitted / `null`: a built-in default allowlist of host variables
 *     is passed through (e.g. `PATH`, `PATHEXT`, `SYSTEMROOT`, `HOME`,
 *     `LANG`) so shells and binaries can be located normally.
 *   - `[]`: strict mode -- nothing from the host environment is
 *     inherited; only `env_vars` is propagated.
 *   - `["FOO", "BAR"]`: exactly those host variables are passed
 *     through. The default allowlist is NOT merged in, so callers that
 *     still need `PATH` must list it explicitly.
 * `env_vars` is always applied on top and overrides any inherited
 * value. Values in `env_vars` may be plain strings or `${VARNAME}`
 * style placeholders resolved by the UTCP client's variable
 * substitutor (note: those placeholders are resolved against the UTCP
 * client's variable sources, not against the host shell -- to forward
 * a host variable by name use `inherit_env_vars`). This closes the
 * secret-exfiltration vector.
 *
 * Attributes:
 *     call_template_type: The type of the call template. Must be "cli".
 *     commands: A list of CommandStep objects defining the commands to execute
 *         in order. Each command can contain UTCP_ARG_argname_UTCP_END placeholders
 *         that will be replaced with values from tool_args during execution.
 *         Placeholders are shell-quoted and therefore expand to exactly
 *         one shell token (see class docstring).
 *     env_vars: A dictionary of environment variables to set for the command's
 *         execution context. Values can be static strings or placeholders for
 *         variables from the UTCP client's variable substitutor. Always
 *         propagated; overrides anything inherited from the host.
 *     inherit_env_vars: Controls which host environment variables are
 *         passed through to the subprocess.
 *           - `undefined` / `null` (default): the built-in default
 *             allowlist (`PATH`, `HOME`, `LANG` on Unix; `PATH`,
 *             `PATHEXT`, `SYSTEMROOT`, `USERPROFILE`, etc. on Windows)
 *             is inherited so shells and binaries work without extra
 *             configuration.
 *           - `[]`: strict mode -- no host variables are inherited at
 *             all. Only `env_vars` reaches the subprocess.
 *           - `["FOO", "BAR"]`: exactly those host variables are
 *             inherited. The default allowlist is replaced, not
 *             extended, so include `PATH` (and any other required
 *             shell vars) yourself if needed.
 *         Variables named here that are not set on the host are
 *         silently skipped. Use this to expose specific host secrets
 *         such as `OPENAI_API_KEY`, `AWS_PROFILE`, or `NODE_PATH`
 *         without putting their values in the call template.
 *     working_dir: The working directory from which to run the commands. If not
 *         provided, it defaults to the current process's working directory.
 *     auth: Authentication details. Not applicable to the CLI protocol, so it
 *         is always None.
 *
 * Examples:
 *     Cross-platform directory operations:
 *     ```json
 *     {
 *       "name": "cross_platform_dir_tool",
 *       "call_template_type": "cli",
 *       "commands": [
 *         {
 *           "command": "cd UTCP_ARG_target_dir_UTCP_END",
 *           "append_to_final_output": false
 *         },
 *         {
 *           "command": "ls -la",
 *           "append_to_final_output": true
 *         }
 *       ]
 *     }
 *     ```
 *     
 *     Referencing previous command output:
 *     ```json
 *     {
 *       "name": "reference_previous_output_tool",
 *       "call_template_type": "cli",
 *       "commands": [
 *         {
 *           "command": "git status --porcelain",
 *           "append_to_final_output": false
 *         },
 *         {
 *           "command": "echo \"Found changes: $CMD_0_OUTPUT\"",
 *           "append_to_final_output": true
 *         }
 *       ]
 *     }
 *     ```
 *
 *     Command with environment variables and placeholders:
 *     ```json
 *     {
 *       "name": "python_multi_step_tool",
 *       "call_template_type": "cli",
 *       "commands": [
 *         {
 *           "command": "python setup.py install",
 *           "append_to_final_output": false
 *         },
 *         {
 *           "command": "python script.py --input UTCP_ARG_input_file_UTCP_END --result \"$CMD_0_OUTPUT\""
 *         }
 *       ],
 *       "env_vars": {
 *         "PYTHONPATH": "/custom/path",
 *         "API_KEY": "${API_KEY_VAR}"
 *       }
 *     }
 *     ```
 *
 * Security Considerations:
 *     - Commands are executed in a subprocess. Ensure that the commands
 *       specified are from a trusted source.
 *     - Avoid passing unsanitized user input directly into the command string.
 *       Use tool argument validation where possible.
 *     - All placeholders are replaced with string values from tool_args.
 *     - Commands should use the appropriate syntax for the target platform
 *       (PowerShell on Windows, Bash on Unix).
 *     - Previous command outputs are available as variables but should be
 *       used carefully to avoid command injection.
 */
export interface CliCallTemplate extends CallTemplate {
  call_template_type: 'cli';
  commands: CommandStep[];
  env_vars?: Record<string, string> | null;
  inherit_env_vars?: string[] | null;
  working_dir?: string | null;
  auth?: undefined;
  allowed_communication_protocols?: string[];
}

/**
 * Zod schema for CLI Call Template.
 */
export const CliCallTemplateSchema: z.ZodType<CliCallTemplate> = z.object({
  name: z.string().optional(),
  call_template_type: z.literal('cli'),
  commands: z
    .array(CommandStepSchema)
    .describe(
      'List of commands to execute in order. Each command can contain ' +
        'UTCP_ARG_argname_UTCP_END placeholders, which are shell-quoted ' +
        'on substitution and therefore expand to exactly one shell token.',
    ),
  env_vars: z
    .record(z.string(), z.string())
    .nullable()
    .optional()
    .describe(
      'Environment variables to set when executing the commands. Always ' +
        'propagated to the subprocess and override values inherited from ' +
        'the host.',
    ),
  inherit_env_vars: z
    .array(z.string())
    .nullable()
    .optional()
    .describe(
      'Controls host environment inheritance. undefined/null (default) ' +
        'inherits a built-in safe allowlist (PATH, HOME / PATHEXT, ' +
        'SYSTEMROOT, etc.). [] disables host inheritance entirely. A ' +
        'list of names replaces the default allowlist with exactly those ' +
        'variables, so include PATH explicitly if your tool needs it. ' +
        'Names not set on the host are skipped silently.',
    ),
  working_dir: z.string().nullable().optional().describe('Working directory for command execution'),
  auth: z.undefined().optional(),
  allowed_communication_protocols: z.array(z.string()).optional().describe('Optional list of allowed communication protocol types for tools within this manual.'),
}).strict() as z.ZodType<CliCallTemplate>;

/**
 * REQUIRED
 * Serializer for converting between `CliCallTemplate` and dictionary representations.
 *
 * This class handles the serialization and deserialization of `CliCallTemplate`
 * objects, ensuring that they can be correctly represented as dictionaries and
 * reconstructed from them, with validation.
 */
export class CliCallTemplateSerializer extends Serializer<CliCallTemplate> {
  /**
   * REQUIRED
   * Converts a `CliCallTemplate` instance to its dictionary representation.
   *
   * @param obj The `CliCallTemplate` instance to serialize.
   * @returns A dictionary representing the `CliCallTemplate`.
   */
  toDict(obj: CliCallTemplate): Record<string, unknown> {
    return {
      name: obj.name,
      call_template_type: obj.call_template_type,
      commands: obj.commands,
      env_vars: obj.env_vars,
      inherit_env_vars: obj.inherit_env_vars,
      working_dir: obj.working_dir,
      auth: obj.auth,
      allowed_communication_protocols: obj.allowed_communication_protocols,
    };
  }

  /**
   * REQUIRED
   * Validates a dictionary and constructs a `CliCallTemplate` instance.
   *
   * @param obj The dictionary to validate and deserialize.
   * @returns A `CliCallTemplate` instance.
   * @throws Error if the dictionary is not a valid representation of a `CliCallTemplate`.
   */
  validateDict(obj: Record<string, unknown>): CliCallTemplate {
    try {
      return CliCallTemplateSchema.parse(obj);
    } catch (e: any) {
      throw new Error(`Invalid CliCallTemplate: ${e.message}\n${e.stack || ''}`);
    }
  }
}