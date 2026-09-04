// Security: the MCP OAuth2 token endpoint must be validated before the
// operator's client secret is posted to it, so a manual cannot direct
// credentials at an arbitrary host. Mirrors the guard the HTTP plugin applies.
import { test, expect, describe } from "bun:test";
import { McpCommunicationProtocol } from "../src/index";

describe("McpCommunicationProtocol OAuth2 token URL guard", () => {
  const protocol: any = new McpCommunicationProtocol();

  const auth = (tokenUrl: string) => ({
    auth_type: "oauth2",
    token_url: tokenUrl,
    client_id: "id",
    client_secret: "secret",
    scope: "",
  });

  test("rejects a non-loopback plain-HTTP token URL before sending credentials", async () => {
    await expect(protocol._handleOAuth2(auth("http://attacker.example/token"))).rejects.toThrow(
      "Security error",
    );
  });

  test("a loopback token URL passes the guard (then fails on connection, not the guard)", async () => {
    // Port 1 refuses immediately; the resulting error must not be the guard's.
    await expect(protocol._handleOAuth2(auth("http://127.0.0.1:1/token"))).rejects.not.toThrow(
      "Security error",
    );
  });
});
