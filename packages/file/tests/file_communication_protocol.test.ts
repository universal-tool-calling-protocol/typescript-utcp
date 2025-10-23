// packages/file/tests/file_communication_protocol.test.ts
import { test, expect, describe, afterEach } from "bun:test";
import { unlink, writeFile } from 'fs/promises';
import path from 'path';
// Import from package indices to trigger auto-registration
import { FileCommunicationProtocol, FileCallTemplate } from "@utcp/file";
import "@utcp/http"; // Needed for OpenAPI conversion
import { IUtcpClient, ApiKeyAuth } from "@utcp/sdk";

const tempFiles: string[] = [];
const mockClient = {} as IUtcpClient;

afterEach(async () => {
  for (const file of tempFiles) {
    try {
      await unlink(file);
    } catch (e) { }
  }
  tempFiles.length = 0;
});

const createTempFile = async (fileName: string, content: string): Promise<string> => {
  const filePath = path.join(import.meta.dir, fileName);
  await writeFile(filePath, content, 'utf-8');
  tempFiles.push(filePath);
  return filePath;
};

describe("FileCommunicationProtocol", () => {
  const protocol = new FileCommunicationProtocol();

  const sampleUtcpManual = {
    utcp_version: "1.0.1",
    manual_version: "1.0.0",
    tools: [
      {
        name: "test.tool",
        description: "A test tool.",
        tool_call_template: {
          name: "test_manual",
          call_template_type: "file",
          file_path: "./dummy.json"
        }
      }
    ]
  };

  const sampleOpenApiSpec = {
    openapi: "3.0.0",
    info: { title: "Test API", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          operationId: "getTest",
          summary: "A test endpoint.",
          responses: { "200": { description: "OK" } }
        }
      }
    }
  };

  describe("registerManual", () => {
    test("should correctly load a UTCP manual from a JSON file", async () => {
      const filePath = await createTempFile("manual.json", JSON.stringify(sampleUtcpManual));
      const callTemplate: FileCallTemplate = {
        name: "test_manual",
        call_template_type: 'file',
        file_path: filePath
      };

      const result = await protocol.registerManual(mockClient, callTemplate);

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.manual.tools).toHaveLength(1);
      expect(result.manual.tools[0]?.name).toBe("test.tool");
    });

    test("should correctly load and convert an OpenAPI spec from a YAML file", async () => {
      const yaml = await import("js-yaml");
      const filePath = await createTempFile("openapi.yaml", yaml.dump(sampleOpenApiSpec));
      const callTemplate: FileCallTemplate = {
        name: "openapi_manual",
        call_template_type: 'file',
        file_path: filePath
      };

      const result = await protocol.registerManual(mockClient, callTemplate);

      expect(result.success).toBe(true);
      expect(result.manual.tools).toHaveLength(1);
      expect(result.manual.tools[0]?.name).toBe("getTest");
    });

    test("should return a failure result for a non-existent file", async () => {
      const callTemplate: FileCallTemplate = {
        name: "nonexistent_manual",
        call_template_type: 'file',
        file_path: "/path/to/nonexistent/file.json"
      };

      const result = await protocol.registerManual(mockClient, callTemplate);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("no such file or directory");
    });

    test("should return a failure result for a malformed JSON file", async () => {
      const filePath = await createTempFile("malformed.json", "{ not json }");
      const callTemplate: FileCallTemplate = {
        name: "malformed_manual",
        call_template_type: 'file',
        file_path: filePath
      };

      const result = await protocol.registerManual(mockClient, callTemplate);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/JSON/i);
    });

    test("should correctly load and convert an OpenAPI spec from a JSON file", async () => {
      const filePath = await createTempFile("openapi.json", JSON.stringify(sampleOpenApiSpec));
      const callTemplate: FileCallTemplate = {
        name: "openapi_json_manual",
        call_template_type: 'file',
        file_path: filePath
      };

      const result = await protocol.registerManual(mockClient, callTemplate);

      expect(result.success).toBe(true);
      expect(result.manual.tools).toHaveLength(1);
      expect(result.manual.tools[0]?.name).toContain("getTest");
    });

    test("should support auth_tools parameter for OpenAPI conversion", async () => {
      const filePath = await createTempFile("openapi_auth.json", JSON.stringify(sampleOpenApiSpec));
      const callTemplate: FileCallTemplate = {
        name: "openapi_with_auth",
        call_template_type: 'file',
        file_path: filePath,
        auth_tools: {
          auth_type: 'api_key',
          var_name: 'X-API-Key',
          api_key: '${API_KEY}',
          location: 'header'
        } as ApiKeyAuth
      };

      const result = await protocol.registerManual(mockClient, callTemplate);

      expect(result.success).toBe(true);
      expect(result.manual.tools).toHaveLength(1);
    });

    test("should fail validation when file_path is not provided", async () => {
      const callTemplate = {
        name: "invalid_manual",
        call_template_type: 'file'
      } as any;

      await expect(async () => {
        await protocol.registerManual(mockClient, callTemplate);
      }).toThrow();
    });
  });

  describe("callTool", () => {
    test("should return the raw content of the specified file", async () => {
      const fileContent = "This is the raw content of the file.";
      const filePath = await createTempFile("content.txt", fileContent);
      const callTemplate: FileCallTemplate = {
        name: "file_content_tool",
        call_template_type: 'file',
        file_path: filePath
      };

      const result = await protocol.callTool(mockClient, "any.tool", {}, callTemplate);
      expect(result).toBe(fileContent);
    });

    test("should throw an error if the file does not exist", async () => {
      const callTemplate: FileCallTemplate = {
        name: "nonexistent_file_tool",
        call_template_type: 'file',
        file_path: "/path/to/nonexistent/file.txt"
      };

      const action = async () => await protocol.callTool(mockClient, "any.tool", {}, callTemplate);
      await expect(action()).rejects.toThrow(/no such file or directory/);
    });

    test("should throw an error when file_path is not provided", async () => {
      const callTemplate = {
        name: "invalid_tool",
        call_template_type: 'file'
      } as any;

      await expect(async () => {
        await protocol.callTool(mockClient, "any.tool", {}, callTemplate);
      }).toThrow();
    });
  });

  describe("callToolStreaming", () => {
    test("should yield the file content as a single chunk", async () => {
      const fileContent = JSON.stringify({ data: "stream content" });
      const filePath = await createTempFile("stream.json", fileContent);
      const callTemplate: FileCallTemplate = {
        name: "streaming_file_tool",
        call_template_type: 'file',
        file_path: filePath
      };

      const stream = protocol.callToolStreaming(mockClient, "any.tool", {}, callTemplate);

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(fileContent);
    });
  });
});