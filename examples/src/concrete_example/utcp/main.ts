import path from 'path';
import { UtcpClient } from '@utcp/sdk/dist/src/client/utcp-client.js';
import { UtcpClientConfigSchema } from '@utcp/sdk/dist/src/client/utcp-client-config.js';
import { TextProviderSchema, TextProvider } from '@utcp/sdk/dist/src/shared/provider.js';
import { UtcpVariablesConfigSchema } from '@utcp/sdk/dist/src/client/utcp-client-config.js';

async function main() {
  const manual_provider: TextProvider = TextProviderSchema.parse({
    "name": "theirstack",
    "provider_type": "text",
    "file_path": "./theirstack_manual.json"
  })

  const client = await UtcpClient.create(UtcpClientConfigSchema.parse({
    variables: {},
    load_variables_from: [
      UtcpVariablesConfigSchema.parse({
        type: 'dotenv',
        env_file_path: path.join(__dirname, '.env')
      })
    ]
  }))

  await client.register_tool_provider(manual_provider);

  try {
    const result = await client.call_tool(
      "theirstack.jobs",
      {
        page: 0,
        limit: 1,
        job_country_code_or: [ "US" ],
        posted_at_max_age_days: 7
      }
    );
    console.log("Tool call result:", JSON.stringify(result));
  } catch (error: any) {
    console.error("Error calling tool:", error.message);
  }
}

(async () => {
    await main();
})()