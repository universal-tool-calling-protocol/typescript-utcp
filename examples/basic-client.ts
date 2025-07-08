import { UtcpClient } from '../src/index';

async function main() {
  try {
    // Create a client with inline provider configuration
    const client = await UtcpClient.create({
      providers: [
        {
          name: "example_provider",
          provider_type: "http",
          url: "https://httpbin.org/get",
          http_method: "GET"
        }
      ]
    });

    // Get available tools
    const tools = client.getAvailableTools();
    console.log('Available tools:', tools.map(t => t.name));

    // Search for tools
    const searchResults = client.searchTools('example');
    console.log('Search results:', searchResults.map(t => t.name));

    // Clean up
    await client.cleanup();
  } catch (error) {
    console.error('Error:', error);
  }
}

if (require.main === module) {
  main();
}
