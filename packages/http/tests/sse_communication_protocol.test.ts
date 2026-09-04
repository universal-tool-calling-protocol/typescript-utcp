// packages/http/tests/sse_communication_protocol.test.ts
import { test, expect, describe, beforeAll, afterAll, spyOn } from "bun:test";
import express, { Express } from 'express';
import { Server } from 'http';
// Import from package index to trigger auto-registration
import { SseCommunicationProtocol, SseCallTemplate, SseProtocolError } from "@utcp/http";
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
const flaky503 = { connections: 0 };
const hugeRetry = { connections: 0 };
const emptyId = { connections: 0, lastEventIds: [] as (string | undefined)[] };
// Responses deliberately left without headers; ended by the test that opened them.
const hanging: express.Response[] = [];

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
  const flakyHandler = (req: express.Request, res: express.Response) => {
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
  };
  app.get("/flaky", flakyHandler);
  app.post("/flaky", flakyHandler);

  // Sets an id, resets it with an empty id, then drops the connection.
  app.get("/empty-id", (req, res) => {
    emptyId.connections += 1;
    emptyId.lastEventIds.push(req.headers['last-event-id'] as string | undefined);
    sseHeaders(res);
    if (emptyId.connections === 1) {
      res.write("id: 1\ndata: {\"seq\":1}\n\nid\ndata: {\"seq\":2}\n\n");
      setTimeout(() => req.socket.destroy(), 10);
      return;
    }
    res.write("data: {\"seq\":3}\n\n");
    res.end();
  });

  // A retry field that is not made of digits must be ignored.
  app.get("/events-bad-retry", (req, res) => {
    sseHeaders(res);
    res.write("retry: -1\ndata: {\"seq\":1}\n\nretry: 20ms\n\n");
    res.end();
  });

  // A 200 that is not an event stream at all.
  app.get("/json-not-sse", (req, res) => {
    res.json({ error: "not a stream" });
  });

  // One multi-line CRLF event whose CRLF is split across two writes.
  app.get("/events-crlf-split", (req, res) => {
    sseHeaders(res);
    res.write("data: line1\r");
    setTimeout(() => {
      res.write("\ndata: line2\r\n\r\n");
      res.end();
    }, 50);
  });

  // Streams data lines without ever sending the blank-line delimiter.
  app.get("/events-no-delimiter", (req, res) => {
    sseHeaders(res);
    for (let i = 0; i < 20; i++) {
      res.write("data: " + "x".repeat(500) + "\n");
    }
    res.end();
  });

  // Drops after the first event, answers the first reconnect with a 503,
  // then serves the rest on the second reconnect.
  app.get("/flaky-503", (req, res) => {
    flaky503.connections += 1;
    if (flaky503.connections === 2) {
      res.status(503).send("restarting");
      return;
    }
    sseHeaders(res);
    if (flaky503.connections === 1) {
      res.write("id: 1\ndata: {\"seq\":1}\n\n");
      setTimeout(() => req.socket.destroy(), 10);
      return;
    }
    res.write("id: 2\ndata: {\"seq\":2}\n\nid: 3\ndata: {\"seq\":3}\n\n");
    res.end();
  });

  // Accepts the connection but never sends response headers.
  app.get("/never-responds", (req, res) => {
    hanging.push(res);
  });

  // First connection asks for a 100 s retry delay, then drops.
  app.get("/huge-retry", (req, res) => {
    hugeRetry.connections += 1;
    sseHeaders(res);
    if (hugeRetry.connections === 1) {
      res.write("id: 1\nretry: 100000\ndata: {\"seq\":1}\n\n");
      setTimeout(() => req.socket.destroy(), 10);
      return;
    }
    res.write("id: 2\ndata: {\"seq\":2}\n\n");
    res.end();
  });

  app.get("/pair/:a/:b", (req, res) => {
    sseHeaders(res);
    res.write(`data: ${JSON.stringify(req.params)}\n\n`);
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

  test("handles CRLF delimiters and discards an unterminated trailing event (spec)", async () => {
    const result = await protocol.callTool(mockClient, "sse_server.sse_tool", {}, template({ url: `http://localhost:${serverPort}/events-crlf` }));
    expect(result).toEqual([{ a: 1 }]);
  });

  test("a malformed retry value is ignored", async () => {
    const result = await protocol.callTool(mockClient, "sse_server.sse_tool", {}, template({ url: `http://localhost:${serverPort}/events-bad-retry` }));
    expect(result).toEqual([{ seq: 1 }]);
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

  describe("framing robustness and bounded reconnects", () => {
    test("a CRLF split across chunks does not end the event early", async () => {
      const result = await protocol.callTool(mockClient, "sse_server.t", {}, template({ url: `http://localhost:${serverPort}/events-crlf-split` }));
      expect(result).toEqual(["line1\nline2"]);
    });

    test("a stream that never sends the event delimiter is rejected, not buffered forever", async () => {
      const original = SseCommunicationProtocol.MAX_EVENT_BUFFER_CHARS;
      (SseCommunicationProtocol as any).MAX_EVENT_BUFFER_CHARS = 1000;
      try {
        const call = protocol.callTool(mockClient, "sse_server.t", {}, template({
          url: `http://localhost:${serverPort}/events-no-delimiter`,
          reconnect: true,
          retry_timeout: 1,
        }));
        await expect(call).rejects.toBeInstanceOf(SseProtocolError);
      } finally {
        (SseCommunicationProtocol as any).MAX_EVENT_BUFFER_CHARS = original;
      }
    });

    test("a failed reconnect handshake is retried, unlike the initial handshake", async () => {
      flaky503.connections = 0;
      const result = await protocol.callTool(mockClient, "sse_server.t", {}, template({
        url: `http://localhost:${serverPort}/flaky-503`,
        reconnect: true,
        retry_timeout: 10,
      }));
      expect(result).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
      expect(flaky503.connections).toBe(3);
    });

    test("a server that accepts the connection but never sends headers cannot hang the call", async () => {
      const original = SseCommunicationProtocol.HANDSHAKE_TIMEOUT_MS;
      (SseCommunicationProtocol as any).HANDSHAKE_TIMEOUT_MS = 300;
      try {
        const started = Date.now();
        const call = protocol.callTool(mockClient, "sse_server.t", {}, template({ url: `http://localhost:${serverPort}/never-responds` }));
        await expect(call).rejects.toBeDefined();
        expect(Date.now() - started).toBeLessThan(3000);
      } finally {
        (SseCommunicationProtocol as any).HANDSHAKE_TIMEOUT_MS = original;
        for (const r of hanging.splice(0)) r.end();
      }
    });

    test("a server-sent retry of 100 s cannot stall the reconnect past MAX_RECONNECT_DELAY_MS", async () => {
      const original = SseCommunicationProtocol.MAX_RECONNECT_DELAY_MS;
      (SseCommunicationProtocol as any).MAX_RECONNECT_DELAY_MS = 50;
      hugeRetry.connections = 0;
      try {
        const started = Date.now();
        const result = await protocol.callTool(mockClient, "sse_server.t", {}, template({
          url: `http://localhost:${serverPort}/huge-retry`,
          reconnect: true,
          retry_timeout: 10,
        }));
        expect(result).toEqual([{ seq: 1 }, { seq: 2 }]);
        expect(hugeRetry.connections).toBe(2);
        expect(Date.now() - started).toBeLessThan(3000);
      } finally {
        (SseCommunicationProtocol as any).MAX_RECONNECT_DELAY_MS = original;
      }
    });

    test("repeated and ${param}-style path parameters are all substituted", async () => {
      const result = await protocol.callTool(mockClient, "sse_server.t", { id: "x" }, template({
        url: `http://localhost:${serverPort}/pair/{id}/\${id}`,
      }));
      expect(result).toEqual([{ a: "x", b: "x" }]);
    });
  });

  describe("spec conformance follow-ups", () => {
    test("event_type 'message' matches events without an event field", async () => {
      // /events sends: event "message" (explicit), event "update", and one with no event field.
      const result = await protocol.callTool(mockClient, "sse_server.t", {}, template({
        url: `http://localhost:${serverPort}/events`,
        event_type: "message",
      }));
      expect(result).toEqual([{ seq: 1, query: {} }, "plain text payload"]);
    });

    test("an empty id resets the last event ID, so no Last-Event-ID header is sent on reconnect", async () => {
      emptyId.connections = 0;
      emptyId.lastEventIds = [];
      const result = await protocol.callTool(mockClient, "sse_server.t", {}, template({
        url: `http://localhost:${serverPort}/empty-id`,
        reconnect: true,
        retry_timeout: 10,
      }));
      expect(result).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
      expect(emptyId.lastEventIds).toEqual([undefined, undefined]);
    });

    test("a 200 that is not text/event-stream fails instead of yielding zero events", async () => {
      const call = protocol.callTool(mockClient, "sse_server.t", {}, template({ url: `http://localhost:${serverPort}/json-not-sse` }));
      await expect(call).rejects.toBeInstanceOf(SseProtocolError);
    });

    test("a dropped POST stream is not re-issued", async () => {
      resetFlaky();
      const received: any[] = [];
      let error: any;
      try {
        for await (const chunk of protocol.callToolStreaming(mockClient, "sse_server.t", { payload: { n: 1 } }, template({
          url: `http://localhost:${serverPort}/flaky`,
          reconnect: true,
          retry_timeout: 10,
          body_field: "payload",
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

    test("a query-string API key is not written to the logs", async () => {
      const logSpy = spyOn(console, "log");
      try {
        await protocol.callTool(mockClient, "sse_server.t", {}, template({
          url: `http://localhost:${serverPort}/events`,
          auth: { auth_type: "api_key", api_key: "qs-secret-value", var_name: "api_key", location: "query" } as any,
        }));
        const logged = logSpy.mock.calls.map(args => args.map(String).join(" ")).join("\n");
        expect(logged).not.toContain("qs-secret-value");
        expect(logged).toContain("/events");
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});
