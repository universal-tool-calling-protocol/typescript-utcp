// packages/http/tests/http_communication_protocol.test.ts
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import express, { Express } from 'express';
import { Server } from 'http';
// Import from package index to trigger auto-registration
import { HttpCommunicationProtocol, HttpCallTemplate } from "@utcp/http";
import { ApiKeyAuth, BasicAuth, OAuth2Auth } from "@utcp/core/data/auth";
import { IUtcpClient } from "@utcp/core/client/utcp_client";

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
  });
});