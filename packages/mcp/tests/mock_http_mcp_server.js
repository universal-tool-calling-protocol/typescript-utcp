// packages/mcp/tests/mock_http_mcp_server.ts
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
const HTTP_PORT = 9999;
const server = new McpServer({ name: "mock-http-server", version: "1.0.0" });
server.registerTool("echo", {
    title: "Echo Tool",
    description: "Echoes back the input message. Useful for testing HTTP connectivity.",
    inputSchema: { message: z.string() },
}, async (input) => {
    const result = { reply: `you said: ${input.message}` };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
server.registerTool("add", {
    title: "Add Tool",
    description: "Adds two numbers together via HTTP. A basic arithmetic operation.",
    inputSchema: { a: z.number(), b: z.number() },
}, async (input) => {
    const result = input.a + input.b;
    return { content: [{ type: "text", text: String(result) }] };
});
const transportOptions = {
    sessionIdGenerator: () => crypto.randomUUID(),
};
const transport = new StreamableHTTPServerTransport(transportOptions);
const httpServer = http.createServer((req, res) => {
    if (req.url === "/mcp") {
        transport.handleRequest(req, res);
    }
    else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
    }
});
// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing HTTP server...');
    httpServer.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    console.log('SIGINT received, closing HTTP server...');
    httpServer.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
(async () => {
    await server.connect(transport);
    httpServer.listen(HTTP_PORT, () => {
        console.log(`Mock HTTP MCP Server listening on port ${HTTP_PORT}`);
    });
})();
