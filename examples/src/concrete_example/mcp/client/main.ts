import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/main.js"],
    cwd: "../server"
  });

  const client = new Client({
    name: "example-client",
    version: "1.0.0"
  });

  await client.connect(transport);

  const result = await client.callTool({
    name: "theirstack.jobs",
    arguments: {
      page: 0,
      limit: 1,
      job_country_code_or: [ "US" ],
      posted_at_max_age_days: 7
    }
  });

  console.log("Tool call result:", result);
}

(async () => {
    await main();
})()
