# @utcp/cli: Command Line Interface Communication Protocol for UTCP

The `@utcp/cli` package enables the `UtcpClient` to interact with command-line tools and programs as UTCP tool providers. This plugin provides a cross-platform way to execute shell commands, scripts, and CLI utilities with full support for multi-step workflows, environment variables, and output chaining.

## Features

*   **Automatic Plugin Registration**: Registers automatically when imported—no manual setup required.
*   **Cross-Platform Support**: Automatically generates platform-specific scripts:
    *   **Windows**: PowerShell scripts with proper error handling
    *   **Unix/Linux/macOS**: Bash scripts with shell compatibility
*   **Multi-Command Workflows**: Execute multiple commands in sequence within a single subprocess, maintaining state between commands.
*   **Output Chaining**: Reference previous command outputs using variables (`$CMD_0_OUTPUT`, `$CMD_1_OUTPUT`, etc.).
*   **Argument Placeholders**: Use `UTCP_ARG_argname_UTCP_END` placeholders for dynamic argument substitution.
*   **Environment Variables**: Configure custom environment variables with UTCP variable substitution support.
*   **Working Directory**: Specify custom working directories for command execution.
*   **Tool Discovery**: Automatically discover tools by executing a discovery command that outputs a UTCP manual.
*   **Smart Output Handling**: Control which command outputs are included in the final result.
*   **JSON Output Parsing**: Automatically parses JSON responses when detected.

## Installation

```bash
bun add @utcp/cli @utcp/sdk

# Or using npm
npm install @utcp/cli @utcp/sdk
```

Note: `@utcp/sdk` is a peer dependency.

## Usage

The CLI plugin registers automatically when you import it—no manual registration needed. Simply import from `@utcp/cli` to enable CLI support.

```typescript
// From your application's entry point

import { UtcpClient } from '@utcp/sdk';
import { CliCallTemplateSerializer } from '@utcp/cli';

async function main() {
  // Define a CLI CallTemplate for single command execution
  const serializer = new CliCallTemplateSerializer();
  const gitStatusTemplate = serializer.validateDict({
    name: 'git_status_tool',
    call_template_type: 'cli',
    commands: [
      {
        command: 'git status --porcelain',
        append_to_final_output: true
      }
    ],
    working_dir: '/path/to/your/repo'
  });

  const client = await UtcpClient.create(process.cwd(), {
    manual_call_templates: [gitStatusTemplate]
  });

  console.log('CLI Plugin active. Executing tools...');

  // Call the CLI tool
  try {
    const result = await client.callTool('git_status_tool', {});
    console.log('Git status result:', result);
  } catch (error) {
    console.error('Error calling CLI tool:', error);
  }

  await client.close();
}

main().catch(console.error);
```

## Advanced Configuration

### Multi-Command Workflows

Execute multiple commands in sequence within a single subprocess. State (like directory changes) is maintained between commands:

```typescript
const serializer = new CliCallTemplateSerializer();
const multiStepTemplate = serializer.validateDict({
  name: 'multi_step_workflow',
  call_template_type: 'cli',
  commands: [
    {
      command: 'cd UTCP_ARG_target_dir_UTCP_END',
      append_to_final_output: false  // Don't include this output in final result
    },
    {
      command: 'git pull origin main',
      append_to_final_output: false  // Don't include this output
    },
    {
      command: 'npm install',
      append_to_final_output: false  // Don't include this output
    },
    {
      command: 'npm test',
      append_to_final_output: true   // Include this output in final result
    }
  ]
});

// Call with arguments
const result = await client.callTool('multi_step_workflow', {
  target_dir: '/path/to/project'
});
```

### Output Chaining

Reference the output of previous commands using variables:

```typescript
const serializer = new CliCallTemplateSerializer();
const outputChainingTemplate = serializer.validateDict({
  name: 'chained_commands',
  call_template_type: 'cli',
  commands: [
    {
      command: 'git rev-parse --short HEAD',
      append_to_final_output: false
    },
    {
      command: 'echo "Building version: $CMD_0_OUTPUT"',
      append_to_final_output: false
    },
    {
      command: 'docker build -t myapp:$CMD_0_OUTPUT .',
      append_to_final_output: true
    }
  ]
});
```

**Platform-Specific Variable Reference:**
- **PowerShell** (Windows): `$CMD_0_OUTPUT`, `$CMD_1_OUTPUT`, etc.
- **Bash** (Unix/Linux/macOS): `$CMD_0_OUTPUT`, `$CMD_1_OUTPUT`, etc.

### Argument Placeholders

Use `UTCP_ARG_argname_UTCP_END` placeholders for dynamic argument substitution:

```typescript
const serializer = new CliCallTemplateSerializer();
const templateWithArgs = serializer.validateDict({
  name: 'deploy_service',
  call_template_type: 'cli',
  commands: [
    {
      command: 'kubectl set image deployment/UTCP_ARG_service_name_UTCP_END ' +
               'UTCP_ARG_service_name_UTCP_END=UTCP_ARG_image_tag_UTCP_END',
      append_to_final_output: true
    },
    {
      command: 'kubectl rollout status deployment/UTCP_ARG_service_name_UTCP_END',
      append_to_final_output: true
    }
  ]
});

// Call with arguments - placeholders will be replaced
const result = await client.callTool('deploy_service', {
  service_name: 'api-server',
  image_tag: 'myapp:v1.2.3'
});
```

### Environment Variables

Configure custom environment variables with UTCP variable substitution:

```typescript
const serializer = new CliCallTemplateSerializer();
const envVarTemplate = serializer.validateDict({
  name: 'python_script',
  call_template_type: 'cli',
  commands: [
    {
      command: 'python analysis.py --input UTCP_ARG_input_file_UTCP_END'
    }
  ],
  env_vars: {
    PYTHONPATH: '/custom/python/path',
    API_KEY: '${MY_API_KEY}',        // Uses UTCP variable substitution
    LOG_LEVEL: 'debug',
    DATABASE_URL: '${DATABASE_URL}'
  },
  working_dir: '/path/to/scripts'
});

const client = await UtcpClient.create(process.cwd(), {
  manual_call_templates: [envVarTemplate],
  variables: {
    python__script_MY_API_KEY: 'secret-key-123',        // Namespaced variable
    python__script_DATABASE_URL: 'postgresql://localhost/mydb'  // Namespaced variable
  }
});
```

### Tool Discovery

Create a CLI provider that discovers its tools dynamically:

```typescript
// Your CLI script should output a UTCP manual when called with a discovery flag
const serializer = new CliCallTemplateSerializer();
const discoveryTemplate = serializer.validateDict({
  name: 'my_cli_tools',
  call_template_type: 'cli',
  commands: [
    {
      command: 'node my-cli-tool.js --utcp-discover',
      append_to_final_output: true
    }
  ]
});

const client = await UtcpClient.create(process.cwd(), {
  manual_call_templates: [discoveryTemplate]
});

// Tools are automatically discovered and registered
const tools = await client.searchTools('my_cli_tools');
console.log('Discovered tools:', tools.map(t => t.name));
```

**Example CLI Tool with Discovery:**

```typescript
// my-cli-tool.ts
if (process.argv.includes('--utcp-discover')) {
  const manual = {
    utcp_version: "1.0.0",
    manual_version: "1.0.0",
    tools: [
      {
        name: "echo_cli",
        description: "Echoes a message via CLI.",
        inputs: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"]
        },
        outputs: { type: "string" },
        tags: ["cli", "echo"],
        tool_call_template: {
          name: "my_cli_tools",
          call_template_type: "cli"
        }
      }
    ]
  };
  console.log(JSON.stringify(manual));
  process.exit(0);
}

// Handle other commands...
```

### Cross-Platform Commands

**Important:** Use platform-appropriate syntax for your commands:

**Windows (PowerShell):**
```typescript
{
  commands: [
    { command: 'Get-ChildItem -Path UTCP_ARG_path_UTCP_END' },
    { command: 'Set-Location -Path UTCP_ARG_new_dir_UTCP_END' }
  ]
}
```

**Unix/Linux/macOS (Bash):**
```typescript
{
  commands: [
    { command: 'ls -la UTCP_ARG_path_UTCP_END' },
    { command: 'cd UTCP_ARG_new_dir_UTCP_END' }
  ]
}
```

The CLI plugin automatically detects the platform and executes commands using the appropriate shell.

## Output Control

Control which command outputs appear in the final result using `append_to_final_output`:

```typescript
{
  commands: [
    {
      command: 'git pull',
      append_to_final_output: false  // Don't include in result
    },
    {
      command: 'npm test',
      append_to_final_output: true   // Include in result
    },
    {
      command: 'npm run build',
      append_to_final_output: true   // Include in result
    }
  ]
}
```

**Default Behavior:**
- If `append_to_final_output` is not specified, only the **last command's output** is included in the final result.
- Set explicitly to `true` or `false` to override this behavior for any command.

## JSON Output Handling

The CLI plugin automatically detects and parses JSON output:

```typescript
const serializer = new CliCallTemplateSerializer();
const jsonOutputTemplate = serializer.validateDict({
  name: 'json_cli_tool',
  call_template_type: 'cli',
  commands: [
    {
      command: 'echo \'{"status": "success", "count": 42}\''
    }
  ]
});

const result = await client.callTool('json_cli_tool', {});
// result = { status: "success", count: 42 }  // Automatically parsed as JSON
```

If output doesn't start with `{` or `[`, it's returned as plain text.

## Command Execution Details

### Single Subprocess Execution

All commands in a template are executed in a **single subprocess**, which means:
- State is preserved between commands (e.g., directory changes with `cd`)
- Environment variables persist across commands
- Variables set in one command can be used in later commands

### Script Generation

The plugin generates platform-specific scripts:

**Windows (PowerShell):**
```powershell
$ErrorActionPreference = "Stop"
# Variables to store command outputs
$CMD_0_OUTPUT = git status 2>&1 | Out-String
$CMD_1_OUTPUT = echo "Status: $CMD_0_OUTPUT" 2>&1 | Out-String
Write-Output $CMD_1_OUTPUT
```

**Unix (Bash):**
```bash
#!/bin/bash
# Variables to store command outputs
CMD_0_OUTPUT=$(git status 2>&1)
CMD_1_OUTPUT=$(echo "Status: $CMD_0_OUTPUT" 2>&1)
echo "${CMD_1_OUTPUT}"
```

### Timeout Configuration

Default timeouts:
- **Tool Discovery**: 30 seconds
- **Tool Execution**: 120 seconds

These provide ample time for multi-command workflows.

## API Reference

### CliCallTemplate

```typescript
interface CliCallTemplate {
  name?: string;
  call_template_type: 'cli';
  commands: CommandStep[];
  env_vars?: Record<string, string> | null;
  working_dir?: string | null;
  auth?: undefined;  // Not applicable for CLI
}
```

### CommandStep

```typescript
interface CommandStep {
  command: string;                     // Command to execute with optional placeholders
  append_to_final_output?: boolean;    // Include in final result (default: true for last command only)
}
```

### Placeholder Syntax

- **Argument Placeholder**: `UTCP_ARG_argname_UTCP_END`
  - Replaced with the value from `tool_args`
  - Example: `UTCP_ARG_filename_UTCP_END` → `'myfile.txt'`

- **Output Reference**: `$CMD_N_OUTPUT` (where N is the command index starting from 0)
  - References the output of previous commands
  - Example: `$CMD_0_OUTPUT` → output from first command

## Security Considerations

**⚠️ Important Security Notes:**

1. **Trusted Commands Only**: Commands are executed in a subprocess. Only use CLI templates from trusted sources.
2. **Avoid Unsanitized Input**: Do not pass unsanitized user input directly into command strings.
3. **Command Injection**: Be cautious when using output references (`$CMD_N_OUTPUT`) to avoid command injection vulnerabilities.
4. **Validate Arguments**: Use proper input validation in your tool definitions.
5. **Environment Variables**: Be careful with sensitive data in environment variables.

## Best Practices

1. **Use Placeholders**: Always use `UTCP_ARG_*_UTCP_END` placeholders instead of string concatenation.
2. **Explicit Output Control**: Explicitly set `append_to_final_output` for clarity in multi-command workflows.
3. **Error Handling**: Wrap tool calls in try-catch blocks for robust error handling.
4. **Working Directory**: Specify `working_dir` when commands depend on specific file locations.
5. **Platform-Specific Syntax**: Use appropriate command syntax for your target platform(s).
6. **Tool Discovery**: Implement discovery commands that output valid UTCP manuals for dynamic tool registration.
7. **Timeouts**: Be mindful of execution time for long-running commands.

## Examples

### Basic File Operations

```typescript
const serializer = new CliCallTemplateSerializer();
const fileOpsTemplate = serializer.validateDict({
  name: 'file_operations',
  call_template_type: 'cli',
  commands: [
    {
      command: 'cat UTCP_ARG_filename_UTCP_END'
    }
  ]
});

const content = await client.callTool('file_operations', {
  filename: '/path/to/file.txt'
});
```

### Build and Test Pipeline

```typescript
const serializer = new CliCallTemplateSerializer();
const buildPipeline = serializer.validateDict({
  name: 'build_and_test',
  call_template_type: 'cli',
  commands: [
    {
      command: 'npm run lint',
      append_to_final_output: false
    },
    {
      command: 'npm test',
      append_to_final_output: true
    },
    {
      command: 'npm run build',
      append_to_final_output: true
    }
  ],
  env_vars: {
    NODE_ENV: 'production',
    CI: 'true'
  }
});
```

### Git Workflow

```typescript
const serializer = new CliCallTemplateSerializer();
const gitWorkflow = serializer.validateDict({
  name: 'git_commit_push',
  call_template_type: 'cli',
  commands: [
    {
      command: 'git add .',
      append_to_final_output: false
    },
    {
      command: 'git commit -m "UTCP_ARG_message_UTCP_END"',
      append_to_final_output: false
    },
    {
      command: 'git push origin UTCP_ARG_branch_UTCP_END',
      append_to_final_output: true
    }
  ]
});

const result = await client.callTool('git_commit_push', {
  message: 'feat: add new feature',
  branch: 'main'
});
```

## Limitations

- **No Streaming Support**: The CLI protocol does not support streaming. All output is returned when the command completes.
- **Platform-Specific**: Commands must be written for the target platform (Windows/Unix).
- **No Interactive Commands**: Interactive CLI tools (that require user input) are not supported.
- **Fixed Timeouts**: Timeout durations are currently fixed (though generous).

## License

This package is part of the UTCP project. See the main repository for license information.
