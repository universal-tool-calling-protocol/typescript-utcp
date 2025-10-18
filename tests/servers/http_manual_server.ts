// packages/core/tests/http_manual_server.ts
import { Tool } from "@utcp/core";
import { HttpCallTemplate } from "@utcp/http";

const manual = {
  utcp_version: "1.0.1",
  manual_version: "1.0.0",
  tools: [
    {
      name: "get_user",
      description: "Gets a user by ID.",
      inputs: { type: 'object', properties: {} },
      outputs: { type: 'object', properties: {} },
      tags: [],
      tool_call_template: {
        name: "http_test_server",
        call_template_type: "http",
        http_method: "GET",
        url: "http://localhost:9998/users/123",
      } as HttpCallTemplate, 
    },
  ] as Tool[],
};

const server = Bun.serve({
  port: 9998,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/utcp") {
      return new Response(JSON.stringify(manual));
    }
    if (url.pathname === "/users/123") {
      return new Response(JSON.stringify({ id: 123, name: "Alice" }));
    }
    return new Response("Not Found", { status: 404 });
  },
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing HTTP server...');
  server.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing HTTP server...');
  server.stop();
  process.exit(0);
});

console.log(`HTTP Manual Server running on port ${server.port}`);