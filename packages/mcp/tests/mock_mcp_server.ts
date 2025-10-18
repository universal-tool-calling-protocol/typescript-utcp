// packages/mcp/tests/mock_mcp_server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mock-stdio-server", version: "1.0.0" });

server.registerTool("echo", {
  title: "Echo Tool",
  description: "Echoes back the input message. Useful for testing connectivity.",
  inputSchema: { message: z.string() },
}, async (input) => {
  const result = { reply: `you said: ${input.message}` };
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("add", {
  title: "Add Tool",
  description: "Adds two numbers together. A basic arithmetic operation.",
  inputSchema: { a: z.number(), b: z.number() },
}, async (input) => {
  const result = input.a + input.b;
  return { content: [{ type: "text", text: String(result) }] };
});

const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
  console.log("Mock STDIN MCP Server is running.");
})(); 