import { UtcpClient } from '../src/index';
import * as path from 'path';

async function main() {
  try {
    // Create a client that loads providers from a file
    const client = await UtcpClient.create({
      providers_file_path: path.join(__dirname, 'providers.json')
    });

    console.log('Client created successfully');

    // Get available tools
    const tools = client.getAvailableTools();
    console.log('Available tools:', tools.map(t => t.name));

    // Search for tools by tag
    const taggedTools = client.getToolsByTag('utcp');
    console.log('Tools with "utcp" tag:', taggedTools.map(t => t.name));

    // Search for tools by query
    const searchResults = client.searchTools('http');
    console.log('Search results for "http":', searchResults.map(t => t.name));

    console.log('Demo completed successfully');
  } catch (error) {
    console.error('Error:', error);
  }
}

if (require.main === module) {
  main();
}
