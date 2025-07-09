import { UtcpClient } from '../src/client/utcp-client';

async function main() {
  console.log('Initializing UTCP client...');

  // Note: The path is relative to the project root (where you run `node`)
  const client = await UtcpClient.create({
    providers_file_path: './examples/providers.json',
  });

  const tools = await client.toolRepository.getTools();

  if (tools.length === 0) {
    console.log('No tools found. Make sure the example server is running.');
    return;
  }

  console.log('Registered tools:');
  for (const tool of tools) {
    console.log(` - ${tool.name}`);
  }

  // Call the first available tool
  const toolToCall = tools[0]!;
  const args = {
    body: { value: 'hello from the client!' },
  };

  console.log(`\nCalling tool: '${toolToCall.name}'...`);
  try {
    const result = await client.callTool(toolToCall.name, args);
    console.log('Tool call result:');
    console.log(result);
  } catch (error) {
    console.error('Error calling tool:', error);
  }
}

main().catch(error => {
  console.error('An unexpected error occurred:', error);
});
