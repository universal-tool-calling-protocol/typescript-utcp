// packages/cli/tests/mock_cli_script.ts
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  const fullArgs = process.argv.slice(2);

  const parsedArgs: Record<string, string | boolean> = {};
  for (let i = 0; i < fullArgs.length; i++) {
    const arg = fullArgs[i];
    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      if (i + 1 < fullArgs.length && !fullArgs[i + 1].startsWith('--')) {
        parsedArgs[key] = fullArgs[++i]; // Value follows key
      } else {
        parsedArgs[key] = true; // Flag without value
      }
    }
  }

  // Use console.log for discovery output to ensure newline and flush
  if (parsedArgs['utcp-discover']) {
    const manual = {
      utcp_version: "1.0.0",
      manual_version: "1.0.0",
      tools: [
        {
          name: "echo_cli",
          description: "Echoes a message via CLI.",
          inputs: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
          outputs: { type: "string" },
          tags: ["cli", "echo"],
          tool_call_template: {
            name: "mock_cli_manual",
            call_template_type: "cli",
            command_name: `node "${path.resolve(__dirname, 'mock_cli_script.ts')}"`
          }
        },
        {
          name: "add_numbers_cli",
          description: "Adds two numbers via CLI.",
          inputs: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
          outputs: { type: "number" },
          tags: ["cli", "math"],
          tool_call_template: {
            name: "mock_cli_manual",
            call_template_type: "cli",
            command_name: `node "${path.resolve(__dirname, 'mock_cli_script.ts')}"`
          }
        },
        {
          name: "read_env",
          description: "Reads a specific environment variable.",
          inputs: { type: "object", properties: { var_name: { type: "string" } }, required: ["var_name"] },
          outputs: { type: "string" },
          tags: ["cli", "env"],
          tool_call_template: {
            name: "mock_cli_manual",
            call_template_type: "cli",
            command_name: `node "${path.resolve(__dirname, 'mock_cli_script.ts')}"`
          }
        },
        {
          name: "write_file_cli",
          description: "Writes content to a file in the CWD.",
          inputs: { type: "object", properties: { filename: { type: "string" }, content: { type: "string" } }, required: ["filename", "content"] },
          outputs: { type: "string" },
          tags: ["cli", "file"],
          tool_call_template: {
            name: "mock_cli_manual",
            call_template_type: "cli",
            command_name: `node "${path.resolve(__dirname, 'mock_cli_script.ts')}"`
          }
        }
      ]
    };
    console.log(JSON.stringify(manual)); // console.log adds a newline by default
    process.exit(0);
  } else if (parsedArgs['message']) {
    // echo_cli
    console.log(JSON.stringify({ echoed_message: parsedArgs['message'] }));
  } else if (parsedArgs['a'] && parsedArgs['b']) {
    // add_numbers_cli
    const a = parseFloat(parsedArgs['a'] as string);
    const b = parseFloat(parsedArgs['b'] as string);
    if (!isNaN(a) && !isNaN(b)) {
      console.log(JSON.stringify({ sum: a + b }));
    } else {
      console.error("Invalid numbers provided for add_numbers_cli.");
      process.exit(1);
    }
  } else if (parsedArgs['var_name']) { // Correctly checks for 'var_name' argument
    // read_env
    const varName = parsedArgs['var_name'] as string;
    const value = process.env[varName];
    console.log(JSON.stringify({ [varName]: value ?? null }));
  } else if (parsedArgs['filename'] && parsedArgs['content']) {
    // write_file_cli
    const filename = parsedArgs['filename'] as string;
    const content = parsedArgs['content'] as string;
    try {
      await fs.writeFile(filename, content);
      console.log(JSON.stringify({ status: `wrote ${filename}` }));
    } catch (error) {
      console.error(`Error writing file: ${error}`);
      process.exit(1);
    }
  } else if (parsedArgs['error']) { // Correctly checks for 'error' flag
    // error command
    console.error("This is a simulated error from CLI.");
    process.exit(1);
  } else {
    // Default error for unknown command
    console.error("Unknown command or missing arguments.");
    process.exit(1);
  }
}

main().catch(console.error);