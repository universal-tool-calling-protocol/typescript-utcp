// packages/http/tests/streamable_http_communication_protocol.test.ts
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import express, { Express } from 'express';
import { Server } from 'http';
// Import from package index to trigger auto-registration
import { StreamableHttpCommunicationProtocol, StreamableHttpCallTemplate } from "@utcp/http";
import { IUtcpClient } from "@utcp/sdk";

// --- Test Server Setup ---
let app: Express;
let server: Server;
let serverPort: number;

const mockClient = {} as IUtcpClient;

const BINARY_PAYLOAD = Buffer.alloc(10_000, 7); // 10,000 bytes of 0x07
const tokenHits = { a: 0, b: 0 };
// Token responses deliberately left unanswered; ended by the test that opened them.
const hangingToken: express.Response[] = [];

beforeAll(async () => {
  app = express();
  app.use(express.json());

  app.get("/utcp", (req, res) => {
    res.json({
      utcp_version: "1.0.1",
      manual_version: "1.0.0",
      tools: [{
        name: "stream_tool",
        description: "A streaming test tool",
        tool_call_template: {
          name: "stream_server",
          call_template_type: 'streamable_http',
          url: `http://localhost:${serverPort}/ndjson`,
          http_method: 'GET',
        }
      }]
    });
  });

  app.get("/ndjson", (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.write(JSON.stringify({ seq: 1, query: req.query }) + "\n");
    setTimeout(() => {
      res.write(JSON.stringify({ seq: 2 }) + "\n");
      setTimeout(() => {
        res.write(JSON.stringify({ seq: 3 }) + "\n");
        res.end();
      }, 10);
    }, 10);
  });

  app.post("/ndjson-echo", (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ body: req.body, header: req.headers['x-custom'] ?? null }) + "\n");
    res.end();
  });

  app.get("/json", (req, res) => {
    res.json({ hello: "world", query: req.query });
  });

  app.get("/binary", (req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    // Write in a few pieces to exercise re-chunking.
    res.write(BINARY_PAYLOAD.subarray(0, 3000));
    res.write(BINARY_PAYLOAD.subarray(3000, 7500));
    res.write(BINARY_PAYLOAD.subarray(7500));
    res.end();
  });

  app.get("/items/:id/detail", (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ id: req.params.id, query: req.query }) + "\n");
    res.end();
  });

  app.get("/auth", (req, res) => {
    if (req.headers['x-api-key'] !== 'secret') {
      return res.status(401).json({ error: "unauthorized" });
    }
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ ok: true }) + "\n");
    res.end();
  });

  app.get("/error", (req, res) => {
    res.status(500).json({ error: "Internal Server Error" });
  });

  app.post("/token-a", (req, res) => {
    tokenHits.a += 1;
    res.json({ access_token: "token-a", expires_in: 3600 });
  });
  app.post("/token-b", (req, res) => {
    tokenHits.b += 1;
    res.json({ access_token: "token-b", expires_in: 3600 });
  });
  app.post("/token-hang", (req, res) => {
    hangingToken.push(res);
  });
  app.get("/whoami", (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ auth: req.headers.authorization ?? null }) + "\n");
    res.end();
  });
  app.get("/pair/:a/:b", (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify(req.params) + "\n");
    res.end();
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      serverPort = (server.address() as any).port;
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

const template = (overrides: Partial<StreamableHttpCallTemplate> & { url: string }): StreamableHttpCallTemplate => ({
  name: "stream_server",
  call_template_type: "streamable_http",
  http_method: "GET",
  content_type: "application/json",
  chunk_size: 4096,
  timeout: 5000,
  ...overrides,
});

describe("StreamableHttpCommunicationProtocol", () => {
  const protocol = new StreamableHttpCommunicationProtocol();

  test("registerManual discovers tools from a manual endpoint", async () => {
    const result = await protocol.registerManual(mockClient, template({ url: `http://localhost:${serverPort}/utcp` }));
    expect(result.success).toBe(true);
    expect(result.manual.tools).toHaveLength(1);
    expect(result.manual.tools[0]?.name).toBe("stream_tool");
  });

  test("callToolStreaming yields one parsed object per NDJSON line", async () => {
    const chunks: any[] = [];
    for await (const chunk of protocol.callToolStreaming(mockClient, "stream_server.stream_tool", { q: "x" }, template({ url: `http://localhost:${serverPort}/ndjson` }))) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ seq: 1, query: { q: "x" } });
    expect(chunks[1]).toEqual({ seq: 2 });
    expect(chunks[2]).toEqual({ seq: 3 });
  });

  test("callTool collects NDJSON chunks into an array", async () => {
    const result = await protocol.callTool(mockClient, "stream_server.stream_tool", {}, template({ url: `http://localhost:${serverPort}/ndjson` }));
    expect(Array.isArray(result)).toBe(true);
    expect(result.map((c: any) => c.seq)).toEqual([1, 2, 3]);
  });

  test("application/json responses are yielded as a single parsed value", async () => {
    const chunks: any[] = [];
    for await (const chunk of protocol.callToolStreaming(mockClient, "stream_server.json_tool", { a: "1" }, template({ url: `http://localhost:${serverPort}/json` }))) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ hello: "world", query: { a: "1" } }]);
  });

  test("binary responses are re-chunked to chunk_size and concatenated by callTool", async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of protocol.callToolStreaming(mockClient, "stream_server.bin", {}, template({ url: `http://localhost:${serverPort}/binary`, chunk_size: 4096 }))) {
      expect(Buffer.isBuffer(chunk)).toBe(true);
      expect(chunk.length).toBeLessThanOrEqual(4096);
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).equals(BINARY_PAYLOAD)).toBe(true);
    // 10,000 bytes at 4096 per chunk -> 4096, 4096, 1808
    expect(chunks.map(c => c.length)).toEqual([4096, 4096, 1808]);

    const full = await protocol.callTool(mockClient, "stream_server.bin", {}, template({ url: `http://localhost:${serverPort}/binary` }));
    expect(Buffer.isBuffer(full)).toBe(true);
    expect((full as Buffer).equals(BINARY_PAYLOAD)).toBe(true);
  });

  test("POST sends body_field as JSON body and header_fields as headers", async () => {
    const result = await protocol.callTool(mockClient, "stream_server.echo", { payload: { n: 42 }, "x-custom": "hdr" }, template({
      url: `http://localhost:${serverPort}/ndjson-echo`,
      http_method: "POST",
      body_field: "payload",
      header_fields: ["x-custom"],
    }));
    expect(result).toEqual([{ body: { n: 42 }, header: "hdr" }]);
  });

  test("path parameters are substituted and the rest become query params", async () => {
    const result = await protocol.callTool(mockClient, "stream_server.detail", { id: "abc/1", limit: 5 }, template({
      url: `http://localhost:${serverPort}/items/{id}/detail`,
    }));
    expect(result).toEqual([{ id: "abc/1", query: { limit: "5" } }]);
  });

  test("missing path parameters throw", async () => {
    const gen = protocol.callToolStreaming(mockClient, "stream_server.detail", {}, template({
      url: `http://localhost:${serverPort}/items/{id}/detail`,
    }));
    await expect(gen.next()).rejects.toThrow(/Missing required path parameter/);
  });

  test("API key auth in header is applied", async () => {
    const result = await protocol.callTool(mockClient, "stream_server.auth", {}, template({
      url: `http://localhost:${serverPort}/auth`,
      auth: { auth_type: "api_key", api_key: "secret", var_name: "x-api-key", location: "header" } as any,
    }));
    expect(result).toEqual([{ ok: true }]);
  });

  test("non-2xx responses reject", async () => {
    const gen = protocol.callToolStreaming(mockClient, "stream_server.err", {}, template({ url: `http://localhost:${serverPort}/error` }));
    await expect(gen.next()).rejects.toThrow(/HTTP 500/);
  });

  test("wrong call template type is rejected", async () => {
    const gen = protocol.callToolStreaming(mockClient, "x", {}, { name: "x", call_template_type: "http" } as any);
    await expect(gen.next()).rejects.toThrow(/StreamableHttpCallTemplate/);
  });

  describe("review follow-ups", () => {
    test("GET with a body_field fails with a clear error instead of a fetch TypeError", async () => {
      const gen = protocol.callToolStreaming(mockClient, "stream_server.t", { payload: { n: 1 } }, template({
        url: `http://localhost:${serverPort}/ndjson`,
        http_method: "GET",
        body_field: "payload",
      }));
      await expect(gen.next()).rejects.toThrow(/http_method is GET/);
    });

    test("GET with a body_field supplied as undefined is still rejected, not silently dropped", async () => {
      const gen = protocol.callToolStreaming(mockClient, "stream_server.t", { payload: undefined }, template({
        url: `http://localhost:${serverPort}/ndjson`,
        http_method: "GET",
        body_field: "payload",
      }));
      await expect(gen.next()).rejects.toThrow(/http_method is GET/);
    });

    test("OAuth2 tokens are cached per token endpoint, not per client_id", async () => {
      tokenHits.a = 0;
      tokenHits.b = 0;
      const oauth = (tokenUrl: string) => ({
        auth_type: "oauth2",
        token_url: tokenUrl,
        client_id: "shared-id",
        client_secret: "s",
      } as any);
      const whoami = (tokenUrl: string) =>
        protocol.callTool(mockClient, "stream_server.t", {}, template({ url: `http://localhost:${serverPort}/whoami`, auth: oauth(tokenUrl) }));

      expect(await whoami(`http://localhost:${serverPort}/token-a`)).toEqual([{ auth: "Bearer token-a" }]);
      expect(await whoami(`http://localhost:${serverPort}/token-b`)).toEqual([{ auth: "Bearer token-b" }]);
      expect(await whoami(`http://localhost:${serverPort}/token-a`)).toEqual([{ auth: "Bearer token-a" }]);
      expect(tokenHits).toEqual({ a: 1, b: 1 });
    });

    test("a stalled OAuth2 token endpoint is bounded by the call timeout, once, not per credential method", async () => {
      const started = Date.now();
      const call = protocol.callTool(mockClient, "stream_server.t", {}, template({
        url: `http://localhost:${serverPort}/whoami`,
        timeout: 800,
        auth: { auth_type: "oauth2", token_url: `http://localhost:${serverPort}/token-hang`, client_id: "c", client_secret: "s" } as any,
      }));
      try {
        await expect(call).rejects.toThrow(/Failed to fetch OAuth2 token/);
        // Two credential methods with a fresh 800 ms budget each would take
        // about 1600 ms; a single shared deadline finishes just after 800 ms.
        expect(Date.now() - started).toBeLessThan(1300);
      } finally {
        for (const r of hangingToken.splice(0)) r.end();
      }
    });

    test("repeated and ${param}-style path parameters are all substituted", async () => {
      const result = await protocol.callTool(mockClient, "stream_server.t", { id: "x" }, template({
        url: `http://localhost:${serverPort}/pair/{id}/\${id}`,
      }));
      expect(result).toEqual([{ a: "x", b: "x" }]);
    });
  });
});
