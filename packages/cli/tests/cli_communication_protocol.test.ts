// packages/cli/tests/cli_communication_protocol.test.ts
import { test, expect, describe, afterEach } from "bun:test";
import { CliCommunicationProtocol } from '../src/cli_communication_protocol';
import { CliCallTemplateSchema, CliCallTemplate } from '../src/cli_call_template';
import { IUtcpClient } from '@utcp/sdk';
import * as path from 'path';
import * as fs from 'fs/promises';

const mockClient = { root_dir: process.cwd() } as IUtcpClient;
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

const createTempDir = async (name: string): Promise<string> => {
  const dirPath = path.join(import.meta.dir, name);
  await fs.mkdir(dirPath, { recursive: true });
  tempDirs.push(dirPath);
  return dirPath;
};

describe('CliCommunicationProtocol (Multi-Command)', () => {
  const cliProtocol = new CliCommunicationProtocol();
  const isWindows = process.platform === 'win32';

  test('should execute a multi-step workflow and return the final output', async () => {
    const callTemplate: CliCallTemplate = CliCallTemplateSchema.parse({
      name: 'multi_step_test',
      call_template_type: 'cli',
      commands: [
        { command: 'echo "Step 1"', append_to_final_output: false },
        { command: 'echo "Step 2"' },
      ],
    });

    const result = await cliProtocol.callTool(mockClient, 'test.workflow', {}, callTemplate);
    expect(result.trim()).toBe('Step 2');
  });

  test('should preserve state (current directory) between commands', async () => {
    const tempDir = await createTempDir('state_test_dir');
    const finalCommand = isWindows ? 'Write-Output (Get-Location).Path' : 'pwd';
    
    const callTemplate: CliCallTemplate = CliCallTemplateSchema.parse({
      name: 'state_preservation_test',
      call_template_type: 'cli',
      commands: [
        { command: `cd "${tempDir}"`, append_to_final_output: false },
        { command: finalCommand, append_to_final_output: true },
      ],
    });

    const result = await cliProtocol.callTool(mockClient, 'test.state', {}, callTemplate);
    expect(path.normalize(result.trim())).toBe(path.normalize(tempDir));
  });

  test('should reference the output of previous commands', async () => {
    const callTemplate: CliCallTemplate = CliCallTemplateSchema.parse({
      name: 'output_referencing_test',
      call_template_type: 'cli',
      commands: [
        { command: 'echo "Hello from command 0"', append_to_final_output: false },
        { command: 'echo "Output of previous step was: $CMD_0_OUTPUT"' },
      ],
    });

    const result = await cliProtocol.callTool(mockClient, 'test.reference', {}, callTemplate);
    expect(result.trim()).toBe('Output of previous step was: Hello from command 0');
  });

  test('should aggregate outputs based on append_to_final_output flag', async () => {
    const callTemplate: CliCallTemplate = CliCallTemplateSchema.parse({
      name: 'output_aggregation_test',
      call_template_type: 'cli',
      commands: [
        { command: 'echo "First"', append_to_final_output: true },
        { command: 'echo "Second"', append_to_final_output: false },
        { command: 'echo "Third"', append_to_final_output: true },
      ],
    });

    const result = await cliProtocol.callTool(mockClient, 'test.aggregation', {}, callTemplate);
    // Normalize line endings for cross-platform comparison
    const normalized = result.trim().replace(/\r\n/g, '\n');
    expect(normalized).toContain('First');
    expect(normalized).toContain('Third');
    expect(normalized).not.toContain('Second');
  });
  
  test('should handle argument substitution in multi-step workflows', async () => {
    const callTemplate: CliCallTemplate = CliCallTemplateSchema.parse({
      name: 'arg_substitution_test',
      call_template_type: 'cli',
      commands: [
        { command: 'echo "Initial message: UTCP_ARG_message_UTCP_END"', append_to_final_output: false },
        { command: 'echo "Received: $CMD_0_OUTPUT"' },
      ],
    });
    
    const result = await cliProtocol.callTool(mockClient, 'test.args', { message: 'Workflow Argument' }, callTemplate);
    // The argument is substituted directly without extra quoting
    expect(result.trim()).toContain('Received: Initial message: Workflow Argument');
  });
  
  test('should use custom environment variables and working directory', async () => {
    const tempDir = await createTempDir('env_test_dir');
    // Use correct PowerShell syntax for environment variables and current directory.
    const envCommand = isWindows ? 'Write-Output "Var is $env:MY_CUSTOM_VAR, CWD is $((Get-Location).Path)"' : 'echo "Var is $MY_CUSTOM_VAR, CWD is $(pwd)"';

    const callTemplate: CliCallTemplate = CliCallTemplateSchema.parse({
      name: 'env_var_test',
      call_template_type: 'cli',
      working_dir: tempDir,
      env_vars: {
        MY_CUSTOM_VAR: 'Hello World from Env',
      },
      commands: [
        { command: envCommand },
      ],
    });

    const result = await cliProtocol.callTool(mockClient, 'test.env', {}, callTemplate);
    expect(result).toInclude('Var is Hello World from Env');
    expect(path.normalize(result.trim())).toContain(path.normalize(tempDir));
  });
});