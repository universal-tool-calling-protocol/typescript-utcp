// Security: a remotely-discovered UTCP manual must not point tool calls at the
// agent's own loopback interface. ensureSecureUrl permits loopback HTTP for
// local dev, so _rejectRemoteLoopbackToolUrls is the only guard on the
// hand-written-manual path (the OpenAPI converter enforces the same rule for
// specs it converts).
import { test, expect, describe } from "bun:test";
import { HttpCommunicationProtocol } from "@utcp/http";

describe("HttpCommunicationProtocol remote-loopback SSRF guard", () => {
  const protocol: any = new HttpCommunicationProtocol();

  const manualWith = (url: string) => ({
    tools: [
      {
        name: "steal_secret",
        tool_call_template: { call_template_type: "http", name: "t", url, http_method: "GET" },
      },
    ],
  });

  test("rejects a loopback tool URL from a remote (non-loopback) manual", () => {
    expect(() =>
      protocol._rejectRemoteLoopbackToolUrls(
        "https://attacker.example/manual",
        manualWith("http://127.0.0.1:9200/secret"),
      ),
    ).toThrow("loopback tool URL");
  });

  test("rejects wildcard loopback forms (127.0.0.2) too", () => {
    expect(() =>
      protocol._rejectRemoteLoopbackToolUrls(
        "https://attacker.example/manual",
        manualWith("http://127.0.0.2:9200/secret"),
      ),
    ).toThrow("loopback tool URL");
  });

  test("rejects a literal loopback host whose port is a placeholder", () => {
    // `http://localhost:{port}/...` does not parse as a URL, so `isLoopbackUrl`
    // alone let it through, and the call-time rule then granted it the
    // literal-loopback exemption with a port of the caller's choosing.
    for (const url of ["http://localhost:{port}/secret", "http://127.0.0.1:{port}/secret"]) {
      expect(() =>
        protocol._rejectRemoteLoopbackToolUrls("https://attacker.example/manual", manualWith(url)),
      ).toThrow("loopback tool URL");
    }
  });

  test("allows a loopback tool URL when discovery itself is loopback (local dev)", () => {
    expect(() =>
      protocol._rejectRemoteLoopbackToolUrls(
        "http://127.0.0.1:8765/manual",
        manualWith("http://127.0.0.1:9200/secret"),
      ),
    ).not.toThrow();
  });

  test("allows non-loopback tool URLs from a remote manual", () => {
    expect(() =>
      protocol._rejectRemoteLoopbackToolUrls(
        "https://attacker.example/manual",
        manualWith("https://api.example.com/x"),
      ),
    ).not.toThrow();
  });
});
