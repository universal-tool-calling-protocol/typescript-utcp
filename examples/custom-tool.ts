import { createUtcpTool, ToolContext, HttpProvider } from '../src/index';

// Example of creating a custom tool
async function main() {
  try {
    // Define a provider
    const provider: HttpProvider = {
      name: 'weather_provider',
      provider_type: 'http',
      url: 'https://api.openweathermap.org/data/2.5/weather',
      http_method: 'GET',
      content_type: 'application/json',
      body_field: 'body'
    };

    // Create a tool using the utility function
    const weatherTool = createUtcpTool(provider, {
      name: 'get_weather',
      description: 'Get current weather for a location',
      tags: ['weather', 'api'],
      inputs: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'City name' },
          appid: { type: 'string', description: 'API key' }
        },
        required: ['q', 'appid']
      },
      outputs: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          main: {
            type: 'object',
            properties: {
              temp: { type: 'number' },
              humidity: { type: 'number' }
            }
          }
        }
      }
    }, function getWeather() {
      return { message: 'Weather tool created' };
    });

    console.log('Created tool:', weatherTool.name);
    console.log('Description:', weatherTool.description);
    console.log('Tags:', weatherTool.tags);
    console.log('Provider:', weatherTool.provider.name);

    // Get all tools from context
    const allTools = ToolContext.getTools();
    console.log('All tools in context:', allTools.map(t => t.name));

    console.log('Custom tool creation completed');
  } catch (error) {
    console.error('Error:', error);
  }
}

if (require.main === module) {
  main();
}
