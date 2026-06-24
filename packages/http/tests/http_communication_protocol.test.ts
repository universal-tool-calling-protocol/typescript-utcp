// packages/http/tests/http_communication_protocol.test.ts
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import express, { Express } from 'express';
import { Server } from 'http';
// Import from package index to trigger auto-registration
import {
  HttpCommunicationProtocol,
  HttpCallTemplate,
  StreamableHttpCommunicationProtocol,
  SseCommunicationProtocol,
} from "@utcp/http";
import { ApiKeyAuth, BasicAuth, OAuth2Auth } from "@utcp/sdk";
import { IUtcpClient } from "@utcp/sdk";

// --- Test Server Setup ---
let app: Express;
let server: Server;
let serverPort: number;

const mockClient = {} as IUtcpClient;

beforeAll(async () => {
  app = express();
  app.use(express.json());

  app.get("/utcp", (req, res) => {
    res.json({
      utcp_version: "1.0.1",
      manual_version: "1.0.0",
      tools: [{
        name: "test_tool",
        description: "A simple test tool",
        tool_call_template: {
          name: "test_server",
          call_template_type: 'http',
          url: `http://localhost:${serverPort}/tool`,
          http_method: 'POST',
        }
      }]
    });
  });

  app.post("/tool", (req, res) => {
    if (req.headers['x-api-key'] && req.headers['x-api-key'] !== 'test-key') {
      return res.status(401).json({ error: "Invalid API Key" });
    }
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Basic ") && authHeader !== `Basic ${btoa("user:pass")}`) {
      return res.status(401).json({ error: "Invalid Basic Auth Credentials" });
    }
    if (authHeader?.startsWith("Bearer ") && authHeader !== "Bearer test-token") {
      return res.status(401).json({ error: "Invalid Bearer Token" });
    }

    res.json({ result: "success", received_body: req.body });
  });

  app.get("/tool/:param1/:param2", (req, res) => {
    res.json({ result: "path_success", params: req.params, query: req.query });
  });

  app.post("/token", (req, res) => {
    res.json({ access_token: "test-token", expires_in: 3600 });
  });

  app.get("/error", (req, res) => {
    res.status(500).json({ error: "Internal Server Error" });
  });

  // Returns a non-2xx with a descriptive JSON body, like a real API does when it
  // refuses a call. Used to prove callTool surfaces that body, not just the status.
  app.post("/forbidden", (req, res) => {
    res.status(403).json({ error: "You are not allowed to do that, and here is exactly why." });
  });

  // GET variant for the streamable/sse discovery (registerManual) error-body test.
  app.get("/forbidden-discovery", (req, res) => {
    res.status(403).send("discovery refused: tenant is not provisioned for streaming");
  });

  // Some APIs nest an OBJECT under `error` — the message must show its JSON,
  // not "[object Object]".
  app.post("/forbidden-object", (req, res) => {
    res.status(422).json({ error: { code: "INVALID_FIELD", reason: "value out of range" } });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      serverPort = (server.address() as any).port;
      console.log(`HTTP test server running on port ${serverPort}`);
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise<void>((resolve) => {
    server.close(() => {
      console.log("HTTP test server stopped.");
      resolve();
    });
  });
});


// --- Test Suite ---
describe("HttpCommunicationProtocol", () => {
  const protocol = new HttpCommunicationProtocol();

  describe("registerManual", () => {
    test("should discover tools from a valid UTCP manual endpoint", async () => {
      const callTemplate: HttpCallTemplate = {
        name: "test_server",
        call_template_type: "http",
        url: `http://localhost:${serverPort}/utcp`,
        http_method: "GET",
      };

      const result = await protocol.registerManual(mockClient, callTemplate);
      expect(result.success).toBe(true);
      expect(result.manual.tools).toHaveLength(1);
      expect(result.manual.tools[0]?.name).toBe("test_tool");
    });

    test("should handle server errors during discovery", async () => {
      const callTemplate: HttpCallTemplate = {
        name: "error_server",
        call_template_type: "http",
        url: `http://localhost:${serverPort}/error`,
        http_method: "GET",
      };

      const result = await protocol.registerManual(mockClient, callTemplate);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("callTool", () => {
    test("should execute a POST tool with a body", async () => {
      const callTemplate: HttpCallTemplate = {
        name: "test_server",
        call_template_type: "http",
        url: `http://localhost:${serverPort}/tool`,
        http_method: "POST",
        body_field: "data"
      };

      const result = await protocol.callTool(mockClient, "test.tool", { data: { value: 123 } }, callTemplate);
      expect(result).toEqual({ result: "success", received_body: { value: 123 } });
    });

    test("should correctly handle path and query parameters", async () => {
      const callTemplate: HttpCallTemplate = {
        name: "path_test",
        call_template_type: "http",
        url: `http://localhost:${serverPort}/tool/{param1}/{param2}`,
        http_method: "GET",
      };

      const result = await protocol.callTool(
        mockClient,
        "test.tool",
        { param1: "foo", param2: "bar", query1: "baz" },
        callTemplate
      );
      expect(result).toEqual({ result: "path_success", params: { param1: "foo", param2: "bar" }, query: { query1: "baz" } });
    });

    test("should handle ApiKeyAuth in headers", async () => {
      const auth: ApiKeyAuth = { auth_type: 'api_key', api_key: 'test-key', var_name: 'X-Api-Key', location: 'header' };
      const callTemplate: HttpCallTemplate = {
        name: "test_server",
        call_template_type: "http",
        url: `http://localhost:${serverPort}/tool`,
        http_method: "POST",
        auth: auth
      };
      const result = await protocol.callTool(mockClient, "test.tool", {}, callTemplate);
      expect(result.result).toBe("success");
    });

    test("should handle BasicAuth", async () => {
      const auth: BasicAuth = { auth_type: 'basic', username: 'user', password: 'pass' };
      const callTemplate: HttpCallTemplate = {
        name: "test_server",
        call_template_type: "http",
        url: `http://localhost:${serverPort}/tool`,
        http_method: "POST",
        auth: auth
      };
      const result = await protocol.callTool(mockClient, "test.tool", {}, callTemplate);
      expect(result.result).toBe("success");
    });

    test("should handle OAuth2Auth", async () => {
      const auth: OAuth2Auth = {
        auth_type: 'oauth2',
        token_url: `http://localhost:${serverPort}/token`,
        client_id: 'test-client',
        client_secret: 'test-secret',
      };
      const callTemplate: HttpCallTemplate = {
        name: "test_server",
        call_template_type: "http",
        url: `http://localhost:${serverPort}/tool`,
        http_method: "POST",
        auth: auth
      };
      const result = await protocol.callTool(mockClient, "test.tool", {}, callTemplate);
      expect(result.result).toBe("success");
    });

    test("should surface the server's error body, not just the status code", async () => {
      const callTemplate: HttpCallTemplate = {
        name: "forbidden_server",
        call_template_type: "http",
        url: `http://localhost:${serverPort}/forbidden`,
        http_method: "POST",
      };

      let thrown: any;
      try {
        await protocol.callTool(mockClient, "test.forbidden", {}, callTemplate);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(Error);
      // The reason the server sent (not just "status code 403") must be present.
      expect(thrown.message).toContain("You are not allowed to do that, and here is exactly why.");
      expect(thrown.message).toContain("403");
      // Enumerable status/data survive structured serialization out of a sandbox.
      expect(thrown.status).toBe(403);
      expect(thrown.data).toEqual({ error: "You are not allowed to do that, and here is exactly why." });
      const roundTripped = JSON.parse(JSON.stringify(thrown));
      expect(roundTripped.status).toBe(403);
      expect(roundTripped.data).toEqual({ error: "You are not allowed to do that, and here is exactly why." });
    });

    test("should JSON-stringify an object-valued error field, not '[object Object]'", async () => {
      const callTemplate: HttpCallTemplate = {
        name: "forbidden_object_server",
        call_template_type: "http",
        url: `http://localhost:${serverPort}/forbidden-object`,
        http_method: "POST",
      };

      let thrown: any;
      try {
        await protocol.callTool(mockClient, "test.forbidden_object", {}, callTemplate);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.message).not.toContain("[object Object]");
      // The structured detail survives in the message...
      expect(thrown.message).toContain("INVALID_FIELD");
      expect(thrown.message).toContain("value out of range");
      // ...and the raw object is preserved on `data`.
      expect(thrown.status).toBe(422);
      expect(thrown.data).toEqual({ error: { code: "INVALID_FIELD", reason: "value out of range" } });
    });
  });
});

// The streamable/sse protocols' callTool paths are stubs; the only real fetch
// that can fail with a body is in registerManual (discovery). These prove that
// failure surfaces the server's body, not just "HTTP 403: Forbidden".
describe("discovery error body (streamable_http + sse)", () => {
  test("StreamableHttpCommunicationProtocol.registerManual surfaces the server body", async () => {
    const protocol = new StreamableHttpCommunicationProtocol();
    const result = await protocol.registerManual(mockClient, {
      name: "forbidden_stream",
      call_template_type: "streamable_http",
      url: `http://localhost:${serverPort}/forbidden-discovery`,
      http_method: "GET",
    } as any);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("discovery refused: tenant is not provisioned for streaming");
    expect(result.errors[0]).toContain("403");
  });

  test("SseCommunicationProtocol.registerManual surfaces the server body", async () => {
    const protocol = new SseCommunicationProtocol();
    const result = await protocol.registerManual(mockClient, {
      name: "forbidden_sse",
      call_template_type: "sse",
      url: `http://localhost:${serverPort}/forbidden-discovery`,
    } as any);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("discovery refused: tenant is not provisioned for streaming");
    expect(result.errors[0]).toContain("403");
  });
});