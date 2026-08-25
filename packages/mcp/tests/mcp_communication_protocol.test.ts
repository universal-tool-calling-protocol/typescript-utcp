// packages/mcp/tests/mcp_communication_protocol.test.ts
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Subprocess } from "bun";
import path from "path";
import { McpCommunicationProtocol, McpCallTemplate } from "../src/index";
import { McpHttpServerSchema } from "../src/mcp_call_template";
import { IUtcpClient } from "@utcp/sdk";
import { Client as McpSdkClient } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

describe("McpHttpServer SSE reconnection config", () => {
  test("defaults notification_stream_max_retries to 0 — no notification-stream reconnect churn", () => {
    const parsed = McpHttpServerSchema.parse({ transport: "http", url: "https://example.com/mcp" });
    expect(parsed.notification_stream_max_retries).toBe(0);
  });

  test("accepts an explicit retry cap for servers whose notifications are consumed", () => {
    const parsed = McpHttpServerSchema.parse({
      transport: "http",
      url: "https://example.com/mcp",
      notification_stream_max_retries: 3,
    });
    expect(parsed.notification_stream_max_retries).toBe(3);
  });

  test("rejects negative and fractional retry caps", () => {
    for (const bad of [-1, 1.5]) {
      expect(() =>
        McpHttpServerSchema.parse({ transport: "http", url: "https://example.com/mcp", notification_stream_max_retries: bad }),
      ).toThrow();
    }
  });
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

    test("rejects an invalid notification_stream_max_retries at the transport boundary", async () => {
      // Server entries travel as `z.any()` inside McpConfigSchema, so the
      // per-field validation must fire where the transport is built — this
      // exercises that path end to end, not the schema in isolation.
      const badTemplate: McpCallTemplate = {
        name: "bad_retry_manual",
        call_template_type: "mcp",
        config: {
          mcpServers: {
            bad_server: {
              transport: 'http',
              url: `http://localhost:${HTTP_PORT}/mcp`,
              notification_stream_max_retries: -1,
            }
          }
        }
      };
      const result = await protocol.registerManual(mockClient, badTemplate);
      expect(result.success).toBe(false);
      expect(result.errors.join(" ")).toContain("notification_stream_max_retries");
    }, 10000);

    test("should throw an error if server name from tool is not in config", async () => {
        await expect(
            protocol.callTool(mockClient, "unknown_server.some_tool", {}, callTemplate)
        ).rejects.toThrow("Configuration for MCP server 'unknown_server' not found in manual 'mock_http_manual'.");
    }, 10000);
  });

  describe("Session eviction on session-class failures (issue #34)", () => {
    const CONFIG = { transport: "stdio" as const, command: "true", timeout: 60 };
    const KEY = "s:stdio";

    /** A fake cached session whose close() we can observe, wired into the
     * protocol's private session map the way _getOrCreateSession would. */
    function seed(protocol: McpCommunicationProtocol, behavior: (calls: number) => Promise<any>) {
      let calls = 0;
      const client = {
        closed: 0,
        close() { this.closed += 1; return Promise.resolve(); },
        op: () => behavior((calls += 1)),
      };
      (protocol as any)._mcpSessions.set(KEY, client);
      (protocol as any)._getOrCreateSession = () => {
        (protocol as any)._mcpSessions.set(KEY, client);
        return Promise.resolve(client);
      };
      return client;
    }

    function run(protocol: McpCommunicationProtocol, client: any) {
      return (protocol as any)._withSession("s", CONFIG, undefined, () => client.op());
    }

    test("an auth failure evicts the dead session instead of caching it forever", async () => {
      // The heart of #34: a 401 never matched the transient allowlist, so the
      // dead transport was reused (and accumulated abort listeners) on every
      // subsequent call, forever.
      const protocol = new McpCommunicationProtocol();
      const client = seed(protocol, () =>
        Promise.reject(new Error("Error POSTing to endpoint (HTTP 401): Unauthorized")));

      await expect(run(protocol, client)).rejects.toThrow("401");
      expect(client.closed).toBe(1);
      expect((protocol as any)._mcpSessions.has(KEY)).toBe(false);
    });

    test("a tool-level JSON-RPC error keeps the healthy session cached", async () => {
      // Evicting on every error would tear down and re-dial per bad tool
      // call — the session is fine, the arguments were not.
      const protocol = new McpCommunicationProtocol();
      const client = seed(protocol, () =>
        Promise.reject(new Error("MCP error -32602: Invalid params")));

      await expect(run(protocol, client)).rejects.toThrow("-32602");
      expect(client.closed).toBe(0);
      expect((protocol as any)._mcpSessions.get(KEY)).toBe(client);
    });

    test("a transient connection error still evicts and retries once", async () => {
      const protocol = new McpCommunicationProtocol();
      const client = seed(protocol, (calls) =>
        calls === 1 ? Promise.reject(new Error("Connection closed")) : Promise.resolve("ok"));

      await expect(run(protocol, client)).resolves.toBe("ok");
      expect(client.closed).toBe(1); // the broken first session was closed
    });

    test("a retry that fails with a session-class error does not leave its session cached", async () => {
      // Server is down for good: first attempt transient, retry hits auth.
      // Pre-fix the retry path had no catch at all, so its dead session
      // stayed cached — the same accumulation #34 reported, one hop later.
      const protocol = new McpCommunicationProtocol();
      const client = seed(protocol, (calls) =>
        Promise.reject(calls === 1 ? new Error("Connection closed") : new Error("403 Forbidden")));

      await expect(run(protocol, client)).rejects.toThrow("403");
      expect(client.closed).toBe(2);
      expect((protocol as any)._mcpSessions.has(KEY)).toBe(false);
    });

    test("an operation timeout evicts the wedged session", async () => {
      // Closing the transport is also what aborts the still-in-flight
      // request, releasing its abort listener — the raced timeout branch
      // #34 asked to see released.
      const protocol = new McpCommunicationProtocol();
      const client = seed(protocol, () => new Promise(() => {}));
      const config = { ...CONFIG, timeout: 1 }; // 1s

      await expect(
        (protocol as any)._withSession("s", config, undefined, () => client.op())
      ).rejects.toThrow("timed out");
      expect(client.closed).toBe(1);
      expect((protocol as any)._mcpSessions.has(KEY)).toBe(false);
    });

    test("an auth failure dressed in connection vocabulary is not retried", async () => {
      // Transports wrap auth rejections in transport language ("connection
      // closed: 401") — the transient markers must not outrank the auth
      // markers, or the dead credential gets a pointless immediate retry.
      const protocol = new McpCommunicationProtocol();
      let calls = 0;
      const client = seed(protocol, () => {
        calls += 1;
        return Promise.reject(new Error("Connection closed: 401 Unauthorized"));
      });

      await expect(run(protocol, client)).rejects.toThrow("401");
      expect(calls).toBe(1); // no retry
      expect(client.closed).toBe(1);
      expect((protocol as any)._mcpSessions.has(KEY)).toBe(false);
    });

    test("the SDK's request-level timeout (-32001) evicts the wedged session", async () => {
      // We forward the same budget to the SDK, so its race usually fires
      // before ours — its error must classify the same way ours does.
      const protocol = new McpCommunicationProtocol();
      const client = seed(protocol, () =>
        Promise.reject(new Error("MCP error -32001: Request timed out")));

      await expect(run(protocol, client)).rejects.toThrow("-32001");
      expect(client.closed).toBe(1);
      expect((protocol as any)._mcpSessions.has(KEY)).toBe(false);
    });

    test("eviction closes the session that failed, never a concurrent caller's replacement", async () => {
      const protocol = new McpCommunicationProtocol();
      const replacement = { closed: 0, close() { this.closed += 1; return Promise.resolve(); } };
      const client = seed(protocol, () => {
        // A concurrent caller replaced the cached session before our catch ran.
        (protocol as any)._mcpSessions.set(KEY, replacement);
        return Promise.reject(new Error("HTTP 401 Unauthorized"));
      });

      await expect(run(protocol, client)).rejects.toThrow("401");
      expect(client.closed).toBe(1); // the failed session is closed
      expect(replacement.closed).toBe(0); // the replacement is untouched
      expect((protocol as any)._mcpSessions.get(KEY)).toBe(replacement); // and stays cached
    });

    test("an auth failure drops the cached OAuth token so the next dial fetches fresh", async () => {
      // The token cache trusts expires_in, but a token can be revoked before
      // its local expiry — evicting only the session would resend the same
      // rejected token on every redial until the TTL ran out.
      const protocol = new McpCommunicationProtocol();
      (protocol as any)._oauthTokens.set("cid", { accessToken: "revoked", expiresAt: Date.now() + 3600_000 });
      const auth = { auth_type: "oauth2", client_id: "cid", client_secret: "s", token_url: "https://x/token" };
      const client = seed(protocol, () =>
        Promise.reject(new Error("HTTP 401 Unauthorized")));

      await expect(
        (protocol as any)._withSession("s", CONFIG, auth, () => client.op())
      ).rejects.toThrow("401");
      expect((protocol as any)._oauthTokens.has("cid")).toBe(false);
    });

    test("a slower token-fetch variant cannot repopulate the cache after invalidation", async () => {
      // _handleOAuth2 races two request shapes with Promise.any. Each used to
      // write the cache on its own success, so the loser landed later and
      // overwrote whatever was there — including an invalidation.
      const protocol = new McpCommunicationProtocol();
      let resolveSlow!: (v: any) => void;
      const slow = new Promise<any>((res) => { resolveSlow = res; });
      let n = 0;
      (protocol as any)._axiosInstance = {
        post: () => (++n === 1
          ? Promise.resolve({ data: { access_token: "fast", expires_in: 3600 } })
          : slow),
      };
      const auth = { auth_type: "oauth2", client_id: "cid", client_secret: "s", token_url: "https://x/token" };

      await expect((protocol as any)._handleOAuth2(auth)).resolves.toBe("fast");
      expect((protocol as any)._oauthTokens.get("cid")?.accessToken).toBe("fast");

      (protocol as any)._invalidateOAuthToken(auth);
      resolveSlow({ data: { access_token: "slow", expires_in: 3600 } });
      await slow;
      await new Promise((r) => setTimeout(r, 0));
      expect((protocol as any)._oauthTokens.has("cid")).toBe(false);
    });

    test("a fetch already in flight when the token is invalidated does not cache its result", async () => {
      const protocol = new McpCommunicationProtocol();
      let resolveFetch!: (v: any) => void;
      const pending = new Promise<any>((res) => { resolveFetch = res; });
      (protocol as any)._axiosInstance = { post: () => pending };
      const auth = { auth_type: "oauth2", client_id: "cid", client_secret: "s", token_url: "https://x/token" };

      const fetching = (protocol as any)._handleOAuth2(auth);
      (protocol as any)._invalidateOAuthToken(auth); // lands mid-flight
      resolveFetch({ data: { access_token: "stale", expires_in: 3600 } });

      // The in-flight attempt still gets its token — only the CACHE is guarded.
      await expect(fetching).resolves.toBe("stale");
      expect((protocol as any)._oauthTokens.has("cid")).toBe(false);
    });

    test("a session whose connect resolves after close() began is closed, not cached", async () => {
      // close() snapshots the cache before an in-flight connect has landed.
      // Without the post-connect check that session would be cached AFTER
      // the sweep and outlive shutdown with a live transport. The SDK
      // client's connect is held open with a deferred so the window is
      // deterministic (and no real server is dialed).
      const originalConnect = McpSdkClient.prototype.connect;
      let releaseConnect!: () => void;
      const connectGate = new Promise<void>((res) => { releaseConnect = res; });
      let closedClients = 0;
      const originalClose = McpSdkClient.prototype.close;
      McpSdkClient.prototype.connect = function () { return connectGate; } as any;
      McpSdkClient.prototype.close = async function () { closedClients += 1; } as any;
      try {
        const protocol = new McpCommunicationProtocol();
        const creating = (protocol as any)._getOrCreateSession("late", CONFIG);
        await protocol.close(); // begins while connect is in flight
        releaseConnect();
        await expect(creating).rejects.toThrow("shut down");
        expect(closedClients).toBe(1); // the late session was closed, not leaked
        expect((protocol as any)._mcpSessions.size).toBe(0);
      } finally {
        McpSdkClient.prototype.connect = originalConnect;
        McpSdkClient.prototype.close = originalClose;
      }
    });

    test("close() drains sessions but the shared registry instance stays usable", async () => {
      // index.ts registers ONE McpCommunicationProtocol into the process-wide
      // registry, shared by every UtcpClient — and UtcpClient.close() closes
      // the registered protocols. A terminal close therefore bricked MCP for
      // every other client in the process the moment any one client closed.
      const originalConnect = McpSdkClient.prototype.connect;
      McpSdkClient.prototype.connect = function () { return Promise.resolve(); } as any;
      try {
        const protocol = new McpCommunicationProtocol();
        const live = { closed: 0, close() { this.closed += 1; return Promise.resolve(); } };
        (protocol as any)._mcpSessions.set(KEY, live);

        await protocol.close();
        expect(live.closed).toBe(1); // the drain really drained
        expect((protocol as any)._mcpSessions.size).toBe(0);

        // A NEW client's session creation must succeed after the drain.
        const created = await (protocol as any)._getOrCreateSession("s", CONFIG);
        expect(created).toBeDefined();
        expect((protocol as any)._mcpSessions.size).toBe(1);
      } finally {
        McpSdkClient.prototype.connect = originalConnect;
      }
    });

    test("a close() landing during the OAuth token fetch aborts before dialing", async () => {
      // The pre-dial \_closing check runs before the token fetch, which is an
      // await — a close() arriving inside it used to let the code dial a
      // brand-new connection after close() had already returned.
      const originalConnect = McpSdkClient.prototype.connect;
      let connectCalls = 0;
      McpSdkClient.prototype.connect = function () { connectCalls += 1; return Promise.resolve(); } as any;
      try {
        const protocol = new McpCommunicationProtocol();
        let releaseToken!: (v: any) => void;
        (protocol as any)._axiosInstance = {
          post: () => new Promise((res) => { releaseToken = res; }),
        };
        const cfg = { transport: "http" as const, url: "https://example.com/mcp" };
        const auth = { auth_type: "oauth2", client_id: "cid", client_secret: "s", token_url: "https://example.com/token" };

        const creating = (protocol as any)._getOrCreateSession("late", cfg, auth);
        await protocol.close(); // lands mid-token-fetch
        releaseToken({ data: { access_token: "tok", expires_in: 3600 } });

        await expect(creating).rejects.toThrow("shut down");
        expect(connectCalls).toBe(0); // never dialed
        expect((protocol as any)._mcpSessions.size).toBe(0);
      } finally {
        McpSdkClient.prototype.connect = originalConnect;
      }
    });

    test("a structured JSON-RPC error mentioning authorization keeps the session AND the token", async () => {
      // The substring heuristics alone would read this tool-level error as a
      // transport auth failure — evicting a healthy session and discarding a
      // valid OAuth token. An McpError is a well-formed response from a live
      // session; only its -32001 timeout code says anything about health.
      const protocol = new McpCommunicationProtocol();
      (protocol as any)._oauthTokens.set("cid", { accessToken: "valid", expiresAt: Date.now() + 3600_000 });
      const auth = { auth_type: "oauth2", client_id: "cid", client_secret: "s", token_url: "https://x/token" };
      const client = seed(protocol, () =>
        Promise.reject(new McpError(-32602, "Authorization header missing for downstream API")));

      await expect(
        (protocol as any)._withSession("s", CONFIG, auth, () => client.op())
      ).rejects.toThrow("Authorization");
      expect(client.closed).toBe(0);
      expect((protocol as any)._mcpSessions.get(KEY)).toBe(client);
      expect((protocol as any)._oauthTokens.has("cid")).toBe(true);
    });

    test("a structured HTTP 401 classifies as auth without relying on message text", async () => {
      const protocol = new McpCommunicationProtocol();
      const client = seed(protocol, () =>
        Promise.reject(new StreamableHTTPError(401, "nope")));

      await expect(run(protocol, client)).rejects.toThrow("nope");
      expect(client.closed).toBe(1);
      expect((protocol as any)._mcpSessions.has(KEY)).toBe(false);
    });

    test("a structured ConnectionClosed (-32000) stays transient: evict + one retry", async () => {
      // -32000 is raised CLIENT-side by the SDK when the session drops
      // mid-request — the exact condition the old "closed" substring
      // classified as transient. The structured gate must not demote it to
      // an operation-level error, or the dead transport stays cached with
      // no retry.
      const protocol = new McpCommunicationProtocol();
      let calls = 0;
      const client = seed(protocol, () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new McpError(ErrorCode.ConnectionClosed, "Connection closed"))
          : Promise.resolve("ok");
      });

      await expect(run(protocol, client)).resolves.toBe("ok");
      expect(calls).toBe(2); // retried once against a fresh session
      expect(client.closed).toBe(1); // the dropped session was evicted
    });

    test("a SERVER-defined -32000 tool error keeps the healthy session — no eviction, no retry", async () => {
      // JSON-RPC reserves -32000..-32099 for implementation-defined SERVER
      // errors, so -32000 in a tool response is legal and arrives through a
      // live session. Only the SDK's client-side ConnectionClosed (fixed
      // message "Connection closed") means the transport dropped; a bare
      // code check would evict a healthy session and burn a retry on every
      // such call.
      const protocol = new McpCommunicationProtocol();
      let calls = 0;
      const client = seed(protocol, () => {
        calls += 1;
        return Promise.reject(new McpError(-32000, "insufficient credits for this tool"));
      });

      await expect(run(protocol, client)).rejects.toThrow("insufficient credits");
      expect(calls).toBe(1); // no retry
      expect(client.closed).toBe(0);
      expect((protocol as any)._mcpSessions.get(KEY)).toBe(client);
    });

    test("overlapping close() calls keep the gate shut until the slowest sweep finishes", async () => {
      // A boolean gate is cleared by whichever close() finishes first — and a
      // second close() finds an already-emptied cache and finishes
      // immediately, reopening creation while the first sweep still awaits a
      // transport's close(). A session dialed in that window outlives the
      // first close with live resources.
      const originalConnect = McpSdkClient.prototype.connect;
      McpSdkClient.prototype.connect = function () { return Promise.resolve(); } as any;
      try {
        const protocol = new McpCommunicationProtocol();
        let releaseClose!: () => void;
        const slow = {
          close() { return new Promise<void>((res) => { releaseClose = res; }); },
        };
        (protocol as any)._mcpSessions.set(KEY, slow);

        const drain1 = protocol.close();   // stuck awaiting slow.close()
        const drain2 = protocol.close();   // sees an empty cache, finishes fast
        await drain2;

        // The first sweep is still running — creation must stay refused.
        await expect((protocol as any)._getOrCreateSession("s", CONFIG))
          .rejects.toThrow("shutting down");

        releaseClose();
        await drain1;

        // Both drains done — the shared instance is usable again.
        const created = await (protocol as any)._getOrCreateSession("s", CONFIG);
        expect(created).toBeDefined();
      } finally {
        McpSdkClient.prototype.connect = originalConnect;
      }
    });

    test("a structured McpError -32001 still evicts as a timeout", async () => {
      const protocol = new McpCommunicationProtocol();
      const client = seed(protocol, () =>
        Promise.reject(new McpError(-32001, "Request timed out")));

      await expect(run(protocol, client)).rejects.toThrow("-32001");
      expect(client.closed).toBe(1);
      expect((protocol as any)._mcpSessions.has(KEY)).toBe(false);
    });
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