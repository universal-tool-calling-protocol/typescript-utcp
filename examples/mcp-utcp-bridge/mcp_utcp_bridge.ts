// examples/mcp-utcp-bridge/mcp_utcp_bridge.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport, StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import path from "path";
import { promises as fs } from "fs";
import http from "node:http";

import { UtcpClient, pluginRegistry } from "@utcp/core";
import { registerHttpPlugin } from "@utcp/http";
import { registerTextPlugin } from "@utcp/text";
import { registerMcpPlugin } from "@utcp/mcp";

// --- Main UTCP Client Singleton ---
let utcpClient: UtcpClient | null = null;
const HTTP_PORT = 9999;

// --- Main Execution ---
async function main() {
  console.log("Initializing UTCP-MCP Bridge...");

  registerHttpPlugin();
  registerTextPlugin();
  registerMcpPlugin();
  console.log("UTCP plugins registered.");

  setupMcpTools();
  utcpClient = await initializeUtcpClient();

  const bridgeScriptPath = path.resolve(import.meta.dir, import.meta.file);
  const connectionConfig = {
    mcpServers: {
      "typescript-utcp-bridge": {
        command: "bun",
        args: ["run", bridgeScriptPath],
      }
    }
  };

  console.log("\n✅ Bridge is ready. To connect, use this configuration in your MCP client's config file:");
  console.log("================================ MCP CONFIG ================================");
  console.log(JSON.stringify(connectionConfig, null, 2));
  console.log("==========================================================================");

  console.log("\nStarting MCP server on stdio...");
  // const transportOptions: StreamableHTTPServerTransportOptions = {
  //   sessionIdGenerator: () => crypto.randomUUID(),
  // };
  // const transport = new StreamableHTTPServerTransport(transportOptions);
  // const httpServer = http.createServer((req, res) => {
  //   // Only handle requests to the /mcp endpoint
  //   if (req.url === "/mcp") {
  //     transport.handleRequest(req, res);
  //   } else {
  //     res.writeHead(404, { "Content-Type": "text/plain" });
  //     res.end("Not Found");
  //   }
  // });
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  // httpServer.listen(HTTP_PORT, () => {
  //   console.log(`\n✅ Bridge is ready and listening on http://localhost:${HTTP_PORT}/mcp`);
  //   console.log("==========================================================================");
  // });
}


// --- MCP Server Setup ---
const mcp = new McpServer({
  name: "UTCP-Client-MCP-Bridge",
  version: "1.0.1",
});

// --- MCP Tool Definitions ---
function setupMcpTools() {
  const AnyCallTemplateSchema = pluginRegistry.getCallTemplateUnionSchema();

  mcp.registerTool("register_manual", {
    title: "Register a UTCP Manual",
    description: "Registers a new tool provider with the UTCP client by providing its call template.",
    inputSchema: {
      manual_call_template: AnyCallTemplateSchema.describe("The call template for the UTCP Manual endpoint."),
    },
  }, async (input) => {
    const client = await initializeUtcpClient();
    try {
      const result = await client.registerManual(input.manual_call_template as any);
      const response = {
        success: result.success,
        manual_name: result.manualCallTemplate.name,
        tools_registered: result.manual.tools.length,
        tool_names: result.manual.tools.map(t => t.name),
        errors: result.errors,
      };
      return { content: [{ type: "text", text: JSON.stringify(response) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  });

  mcp.registerTool("deregister_manual", {
    title: "Deregister a UTCP Manual",
    description: "Deregisters a tool provider from the UTCP client.",
    inputSchema: {
      manual_name: z.string().describe("The name of the manual to deregister."),
    },
  }, async (input) => {
    const client = await initializeUtcpClient();
    try {
      const success = await client.deregisterManual(input.manual_name);
      const response = {
        success,
        message: success
          ? `Manual '${input.manual_name}' deregistered.`
          : `Manual '${input.manual_name}' not found.`,
      };
      return { content: [{ type: "text", text: JSON.stringify(response) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  });

  mcp.registerTool("call_tool", {
    title: "Call a UTCP Tool",
    description: "Calls a registered tool by its full namespaced name.",
    inputSchema: {
      tool_name: z.string().describe("The full name of the tool to call (e.g., 'my_manual.my_tool')."),
      arguments: z.record(z.string(), z.any()).describe("A JSON object of arguments for the tool call."),
    },
  }, async (input) => {
    const client = await initializeUtcpClient();
    try {
      const result = await client.callTool(input.tool_name, input.arguments);
      const response = {
        success: true,
        tool_name: input.tool_name,
        result: result,
      };
      return { content: [{ type: "text", text: JSON.stringify(response) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  });

  mcp.registerTool("search_tools", {
    title: "Search for UTCP Tools",
    description: "Searches for relevant tools based on a task description.",
    inputSchema: {
      task_description: z.string().describe("A natural language description of the task."),
      limit: z.number().optional().default(10).describe("The maximum number of tools to return."),
    },
  }, async (input) => {
    const client = await initializeUtcpClient();
    try {
      const tools = await client.searchTools(input.task_description, input.limit);
      const simplifiedTools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputs,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ tools: simplifiedTools }) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  });

  mcp.registerTool("list_tools", {
    title: "List All Registered UTCP Tools",
    description: "Returns a list of all tools currently registered and available in the UTCP client.",
    inputSchema: {},
  }, async () => {
    const client = await initializeUtcpClient();
    try {
      const tools = await client.toolRepository.getTools();
      const toolInfo = tools.map(t => ({ name: t.name, description: t.description }));
      return { content: [{ type: "text", text: JSON.stringify({ tools: toolInfo }) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: e.message }) }] };
    }
  });
}


async function initializeUtcpClient(): Promise<UtcpClient> {
  if (utcpClient) {
    return utcpClient;
  }

  const scriptDir = import.meta.dir;
  const configPath = path.resolve(scriptDir, '.utcp_config.json');
  console.log(`Searching for UTCP config file at: ${configPath}`);
  let config = {};

  try {
    const configFileContent = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(configFileContent);
    console.log("Loaded UTCP client configuration from .utcp_config.json");
  } catch {
    console.log("No .utcp_config.json found. Initializing with default config.");
  }

  utcpClient = await UtcpClient.create(config);
  return utcpClient;
}


main().catch(err => {
  console.error("Failed to start UTCP-MCP Bridge:", err);
  process.exit(1);
});