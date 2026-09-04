// packages/http/tests/sse_communication_protocol.test.ts
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import express, { Express } from 'express';
import { Server } from 'http';
// Import from package index to trigger auto-registration
import { SseCommunicationProtocol, SseCallTemplate } from "@utcp/http";
import { IUtcpClient } from "@utcp/sdk";

// --- Test Server Setup ---
let app: Express;
let server: Server;
let serverPort: number;

const mockClient = {} as IUtcpClient;

const flaky = { connections: 0, lastEventIds: [] as (string | undefined)[], alwaysDrop: false };
function resetFlaky(alwaysDrop = false) {
  flaky.connections = 0;
  flaky.lastEventIds = [];
  flaky.alwaysDrop = alwaysDrop;
}

function sseHeaders(res: express.Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  // Keep-alive on purpose: earlier tests leave pooled sockets behind, and the
  // reconnection tests must still see exact hit counts. The protocol opts out
  // of socket reuse for streams (keepalive: false) so Bun's transparent
  // request replay on a dead pooled socket cannot bypass its reconnect logic.
  res.setHeader('Connection', 'keep-alive');
}

beforeAll(async () => {
  app = express();
  app.use(express.json());

  app.get("/utcp", (req, res) => {
    res.json({
      utcp_version: "1.0.1",
      manual_version: "1.0.0",
      tools: [{
        name: "sse_tool",
        description: "An SSE test tool",
        tool_call_template: {
          name: "sse_server",
          call_template_type: 'sse',
          url: `http://localhost:${serverPort}/events`,
        }
      }]
    });
  });

  // Emits: a comment, a JSON "message" event, a multi-line "update" event,
  // a plain-text event with an id and a retry, then closes.
  app.get("/events", (req, res) => {
    sseHeaders(res);
    res.write(": keep-alive comment\n\n");
    res.write(`event: message\ndata: ${JSON.stringify({ seq: 1, query: req.query })}\n\n`);
    setTimeout(() => {
      res.write("event: update\ndata: {\"seq\":\ndata: 2}\n\n");
      setTimeout(() => {
        res.write("id: 3\nretry: 1000\ndata: plain text payload\n\n");
        res.end();
      }, 10);
    }, 10);
  });

  // CRLF line endings and a final event without trailing blank line.
  app.get("/events-crlf", (req, res) => {
    sseHeaders(res);
    res.write("data: {\"a\":1}\r\n\r\n");
    res.write("data: {\"a\":2}");
    res.end();
  });

  app.post("/events-echo", (req, res) => {
    sseHeaders(res);
    res.write(`data: ${JSON.stringify({ body: req.body, header: req.headers['x-custom'] ?? null, accept: req.headers['accept'] })}\n\n`);
    res.end();
  });

  app.get("/topics/:topic/events", (req, res) => {
    sseHeaders(res);
    res.write(`data: ${JSON.stringify({ topic: req.params.topic, query: req.query })}\n\n`);
    res.end();
  });

  app.get("/auth", (req, res) => {
    if (req.headers.authorization !== `Basic ${Buffer.from("user:pass").toString("base64")}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
    sseHeaders(res);
    res.write("data: {\"ok\":true}\n\n");
    res.end();
  });

  app.get("/error", (req, res) => {
    res.status(500).json({ error: "Internal Server Error" });
  });

  // Serves the first event then drops the TCP connection on the first connection
  // (or on every connection when alwaysDrop is set). A reconnecting client is
  // served the remaining events and a clean end of stream.
  app.get("/flaky", (req, res) => {
    flaky.connections += 1;
    flaky.lastEventIds.push(req.headers['last-event-id'] as string | undefined);
    sseHeaders(res);
    if (flaky.alwaysDrop || flaky.connections === 1) {
      res.write("id: 1\nretry: 20\ndata: {\"seq\":1}\n\n");
      setTimeout(() => req.socket.destroy(), 10);
      return;
    }
    res.write("id: 2\ndata: {\"seq\":2}\n\n");
    res.write("id: 3\ndata: {\"seq\":3}\n\n");
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

const template = (overrides: Partial<SseCallTemplate> & { url: string }): SseCallTemplate => ({
  name: "sse_server",
  call_template_type: "sse",
  reconnect: true,
  retry_timeout: 30000,
  ...overrides,
});

describe("SseCommunicationProtocol", () => {
  const protocol = new SseCommunicationProtocol();

  test("registerManual discovers tools from a manual endpoint", async () => {
    const result = await protocol.registerManual(mockClient, template({ url: `http://localhost:${serverPort}/utcp` }));
    expect(result.success).toBe(true);
    expect(result.manual.tools).toHaveLength(1);
    expect(result.manual.tools[0]?.name).toBe("sse_tool");
  });

  test("callToolStreaming yields each event payload, parsing JSON where possible", async () => {
    const chunks: any[] = [];
    for await (const chunk of protocol.callToolStreaming(mockClient, "sse_server.sse_tool", { q: "x" }, template({ url: `http://localhost:${serverPort}/events` }))) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([
      { seq: 1, query: { q: "x" } },
      { seq: 2 },
      "plain text payload",
    ]);
  });

  test("callTool collects all event payloads into an array", async () => {
    const result = await protocol.callTool(mockClient, "sse_server.sse_tool", {}, template({ url: `http://localhost:${serverPort}/events` }));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result[0].seq).toBe(1);
  });

  test("event_type filters events", async () => {
    const result = await protocol.callTool(mockClient, "sse_server.sse_tool", {}, template({
      url: `http://localhost:${serverPort}/events`,
      event_type: "update",
    }));
    expect(result).toEqual([{ seq: 2 }]);
  });

  test("handles CRLF delimiters and a trailing unterminated event", async () => {
    const result = await protocol.callTool(mockClient, "sse_server.sse_tool", {}, template({ url: `http://localhost:${serverPort}/events-crlf` }));
    expect(result).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test("body_field switches to POST with a JSON body, header_fields become headers, Accept is set", async () => {
    const result = await protocol.callTool(mockClient, "sse_server.echo", { payload: { n: 42 }, "x-custom": "hdr" }, template({
      url: `http://localhost:${serverPort}/events-echo`,
      body_field: "payload",
      header_fields: ["x-custom"],
    }));
    expect(result).toEqual([{ body: { n: 42 }, header: "hdr", accept: "text/event-stream" }]);
  });

  test("path parameters are substituted and the rest become query params", async () => {
    const result = await protocol.callTool(mockClient, "sse_server.topic", { topic: "news", limit: 5 }, template({
      url: `http://localhost:${serverPort}/topics/{topic}/events`,
    }));
    expect(result).toEqual([{ topic: "news", query: { limit: "5" } }]);
  });

  test("Basic auth is applied", async () => {
    const result = await protocol.callTool(mockClient, "sse_server.auth", {}, template({
      url: `http://localhost:${serverPort}/auth`,
      auth: { auth_type: "basic", username: "user", password: "pass" } as any,
    }));
    expect(result).toEqual([{ ok: true }]);
  });

  test("non-2xx responses reject", async () => {
    const gen = protocol.callToolStreaming(mockClient, "sse_server.err", {}, template({ url: `http://localhost:${serverPort}/error` }));
    await expect(gen.next()).rejects.toThrow(/HTTP 500/);
  });

  test("wrong call template type is rejected", async () => {
    const gen = protocol.callToolStreaming(mockClient, "x", {}, { name: "x", call_template_type: "http" } as any);
    await expect(gen.next()).rejects.toThrow(/SseCallTemplate/);
  });

  describe("reconnection", () => {
    test("resumes a dropped stream with Last-Event-ID and yields every event once", async () => {
      resetFlaky();
      const result = await protocol.callTool(mockClient, "sse_server.flaky", {}, template({
        url: `http://localhost:${serverPort}/flaky`,
        reconnect: true,
        retry_timeout: 1000, // overridden by the server's "retry: 20"
      }));
      expect(result).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
      expect(flaky.connections).toBe(2);
      expect(flaky.lastEventIds).toEqual([undefined, "1"]);
    });

    test("with reconnect disabled a dropped stream surfaces as an error after the events received so far", async () => {
      resetFlaky();
      const received: any[] = [];
      let error: any;
      try {
        for await (const chunk of protocol.callToolStreaming(mockClient, "sse_server.flaky", {}, template({
          url: `http://localhost:${serverPort}/flaky`,
          reconnect: false,
          retry_timeout: 10,
        }))) {
          received.push(chunk);
        }
      } catch (e) {
        error = e;
      }
      expect(error).toBeDefined();
      expect(received).toEqual([{ seq: 1 }]);
      expect(flaky.connections).toBe(1);
    });

    test("gives up after MAX_RECONNECT_ATTEMPTS so a tool call cannot hang forever", async () => {
      resetFlaky(true);
      const gen = protocol.callTool(mockClient, "sse_server.flaky", {}, template({
        url: `http://localhost:${serverPort}/flaky`,
        reconnect: true,
        retry_timeout: 10,
      }));
      await expect(gen).rejects.toBeDefined();
      expect(flaky.connections).toBe(1 + SseCommunicationProtocol.MAX_RECONNECT_ATTEMPTS);
    });
  });
});
