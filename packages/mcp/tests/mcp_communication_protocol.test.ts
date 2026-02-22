// packages/mcp/tests/mcp_communication_protocol.test.ts
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Subprocess } from "bun";
import path from "path";
import { McpCommunicationProtocol, McpCallTemplate } from "../src/index";
import { IUtcpClient } from "@utcp/sdk";

const HTTP_PORT = 9999;
let stdioServerProcess: Subprocess | null = null;
let httpServerProcess: Subprocess | null = null;

const mockClient = {} as IUtcpClient;

// Emergency cleanup handler if tests are interrupted
const cleanupProcesses = () => {
  const isWindows = process.platform === "win32";
  
  if (stdioServerProcess && stdioServerProcess.pid) {
    try {
      if (isWindows) {
        Bun.spawnSync(["taskkill", "/F", "/T", "/PID", stdioServerProcess.pid.toString()]);
      } else {
        stdioServerProcess.kill(9);
      }
    } catch (e) {
      // Ignore errors
    }
  }
  
  if (httpServerProcess && httpServerProcess.pid) {
    try {
      if (isWindows) {
        Bun.spawnSync(["taskkill", "/F", "/T", "/PID", httpServerProcess.pid.toString()]);
      } else {
        httpServerProcess.kill(9);
      }
    } catch (e) {
      // Ignore errors
    }
  }
};

// Register cleanup on process exit
process.on('exit', cleanupProcesses);
process.on('SIGINT', () => {
  cleanupProcesses();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupProcesses();
  process.exit(143);
});

const awaitServerReady = async (stream: ReadableStream<Uint8Array>, readyMessage: string, timeout = 20000) => {
  const reader = stream.getReader();
  const start = Date.now();
  let output = "";

  try {
    while (Date.now() - start < timeout) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      output += chunk;
      if (output.includes(readyMessage)) {
        console.log(`Server ready message found: "${readyMessage}"`);
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(`Server did not emit ready message "${readyMessage}" in time. Full output:\n${output}`);
};

beforeAll(async () => {
  console.log("Starting mock MCP servers for testing...");

  const stdioServerPath = path.resolve(import.meta.dir, "mock_mcp_server.ts");
  stdioServerProcess = Bun.spawn(["bun", "run", stdioServerPath], {
    stdout: "pipe",
    stderr: "inherit",
    windowsHide: true,
  });
  console.log(`Spawned stdio server with PID: ${stdioServerProcess.pid}`);
  await awaitServerReady(stdioServerProcess.stdout, "Mock STDIN MCP Server is running.");

  const httpServerPath = path.resolve(import.meta.dir, "mock_http_mcp_server.ts");
  httpServerProcess = Bun.spawn(["bun", "run", httpServerPath], {
    stdout: "pipe",
    stderr: "inherit",
    windowsHide: true,
  });
  console.log(`Spawned http server with PID: ${httpServerProcess.pid}`);
  await awaitServerReady(httpServerProcess.stdout, `Mock HTTP MCP Server listening on port ${HTTP_PORT}`);

  console.log("Both mock servers are ready.");
}, 25000);

afterAll(async () => {
  console.log("Stopping mock MCP servers...");
  
  const isWindows = process.platform === "win32";
  
  // Force kill processes to ensure cleanup
  if (stdioServerProcess && stdioServerProcess.pid) {
    if (isWindows) {
      // On Windows, use taskkill to kill the entire process tree
      try {
        Bun.spawnSync(["taskkill", "/F", "/T", "/PID", stdioServerProcess.pid.toString()]);
      } catch (e) {
        // Ignore errors if process already terminated
      }
    } else {
      stdioServerProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!stdioServerProcess.killed) {
        stdioServerProcess.kill(9);
      }
    }
  }
  
  if (httpServerProcess && httpServerProcess.pid) {
    if (isWindows) {
      // On Windows, use taskkill to kill the entire process tree
      try {
        Bun.spawnSync(["taskkill", "/F", "/T", "/PID", httpServerProcess.pid.toString()]);
      } catch (e) {
        // Ignore errors if process already terminated
      }
    } else {
      httpServerProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!httpServerProcess.killed) {
        httpServerProcess.kill(9);
      }
    }
  }
  
  // Extra safety: wait a bit for ports to be released
  await new Promise(resolve => setTimeout(resolve, 300));
  console.log("Mock servers stopped.");
});

describe("McpCommunicationProtocol", () => {

  describe("Stdio Transport", () => {
    const stdioServerPath = path.resolve(import.meta.dir, "mock_mcp_server.ts");
    const callTemplate: McpCallTemplate = {
      name: "mock_stdio_manual",
      call_template_type: "mcp",
      config: {
        mcpServers: {
          mock_stdio_server: {
            transport: 'stdio',
            command: 'bun',
            args: ['run', stdioServerPath],
            cwd: path.dirname(stdioServerPath)
          }
        }
      }
    };

    test("should register manual and discover tools from stdio server", async () => {
      const protocol = new McpCommunicationProtocol();
      try {
        const result = await protocol.registerManual(mockClient, callTemplate);
        expect(result.success).toBe(true);
        expect(result.manual.tools.length).toBeGreaterThan(0);
        expect(result.manual.tools.some(t => t?.name === "mock_stdio_manual.mock_stdio_server.echo")).toBe(true);
      } finally {
        await protocol.close();
      }
    });

    test("should call a tool with structured output via stdio", async () => {
      const protocol = new McpCommunicationProtocol();
      try {
        const result = await protocol.callTool(mockClient, "mock_stdio_server.echo", { message: "hello stdio" }, callTemplate);
        expect(result).toEqual({ reply: "you said: hello stdio" });
      } finally {
        await protocol.close();
      }
    });

    test("should call a tool with primitive output via stdio", async () => {
      const protocol = new McpCommunicationProtocol();
      try {
        const result = await protocol.callTool(mockClient, "mock_stdio_server.add", { a: 10, b: 5 }, callTemplate);
        expect(result).toBe(15);
      } finally {
        await protocol.close();
      }
    });
  });

  describe("HTTP Transport", () => {
    const protocol = new McpCommunicationProtocol();
    
    // For HTTP transport, we can reuse sessions since they're stateful on the server.
    // Only close once after all tests are done.
    afterAll(async () => {
      await protocol.close();
    });

    const callTemplate: McpCallTemplate = {
      name: "mock_http_manual",
      call_template_type: "mcp",
      config: {
        mcpServers: {
          mock_http_server: {
            transport: 'http',
            url: `http://localhost:${HTTP_PORT}/mcp`,
          }
        }
      }
    };

    test("should register manual and discover tools from http server", async () => {
      const result = await protocol.registerManual(mockClient, callTemplate);
      expect(result.success).toBe(true);
      expect(result.manual.tools).toHaveLength(2);
      expect(result.manual.tools[0]?.name).toBe("mock_http_manual.mock_http_server.echo");
      expect(result.manual.tools[1]?.name).toBe("mock_http_manual.mock_http_server.add");
    });

    test("should call a tool with structured output via http", async () => {
      // This test will now reuse the session created in the previous test
      const result = await protocol.callTool(mockClient, "mock_http_server.echo", { message: "hello http" }, callTemplate);
      expect(result).toEqual({ reply: "you said: hello http" });
    }, 10000);

    test("should call a tool with primitive output via http", async () => {
      const result = await protocol.callTool(mockClient, "mock_http_server.add", { a: 20, b: 5 }, callTemplate);
      expect(result).toBe(25);
    }, 10000);
    
    test("should throw an error if tool name is not namespaced correctly", async () => {
        await expect(
            protocol.callTool(mockClient, "nonexistent_tool", {}, callTemplate)
        ).rejects.toThrow("Invalid MCP tool name format: 'nonexistent_tool'. Expected 'manualName.serverName.toolName'.");
    }, 10000);

    test("should throw an error if server name from tool is not in config", async () => {
        await expect(
            protocol.callTool(mockClient, "unknown_server.some_tool", {}, callTemplate)
        ).rejects.toThrow("Configuration for MCP server 'unknown_server' not found in manual 'mock_http_manual'.");
    }, 10000);
  });

  describe("Timeout forwarding", () => {
    test("forwards configured timeout to listTools and callTool", async () => {
      const capturedOpts: any[] = [];
      const fakeClient = {
        listTools: (_params: any, opts: any) => {
          capturedOpts.push({ method: "listTools", opts });
          return Promise.resolve({ tools: [{ name: "t", description: "", inputSchema: {}, outputSchema: {} }] });
        },
        callTool: (_params: any, _result: any, opts: any) => {
          capturedOpts.push({ method: "callTool", opts });
          return Promise.resolve({ content: [{ type: "text", text: "ok" }] });
        },
      };

      const protocol = new McpCommunicationProtocol();
      (protocol as any)._getOrCreateSession = () => Promise.resolve(fakeClient);

      const template: McpCallTemplate = {
        name: "m",
        call_template_type: "mcp",
        config: { mcpServers: { s: { transport: "stdio" as const, command: "true", timeout: 90 } } },
      };

      await protocol.registerManual(mockClient, template);
      await protocol.callTool(mockClient, "s.t", {}, template);

      expect(capturedOpts).toHaveLength(2);
      expect(capturedOpts[0]).toEqual({ method: "listTools", opts: { timeout: 90_000 } });
      expect(capturedOpts[1]).toEqual({ method: "callTool", opts: { timeout: 90_000 } });
    });
  });
});