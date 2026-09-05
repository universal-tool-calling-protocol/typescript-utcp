// Security: the MCP OAuth2 token endpoint must be validated before the
// operator's client secret is posted to it, so a manual cannot direct
// credentials at an arbitrary host. Mirrors the guard the HTTP plugin applies.
// The HTTP session is stubbed so the guard is exercised without network I/O.
import { test, expect, describe, mock } from "bun:test";
import { McpCommunicationProtocol } from "../src/index";

describe("McpCommunicationProtocol OAuth2 token URL guard", () => {
  const auth = (tokenUrl: string) => ({
    auth_type: "oauth2",
    token_url: tokenUrl,
    client_id: "id",
    client_secret: "secret",
    scope: "",
  });

  test("rejects a non-loopback plain-HTTP token URL without ever posting credentials", async () => {
    const protocol: any = new McpCommunicationProtocol();
    const post = mock(async () => ({ data: { access_token: "tok", expires_in: 3600 } }));
    protocol._axiosInstance = { post };

    await expect(protocol._handleOAuth2(auth("http://attacker.example/token"))).rejects.toThrow(
      "Security error",
    );
    // The guard must run before any request: the credential POST is never made.
    expect(post).toHaveBeenCalledTimes(0);
  });

  test("a secure token URL passes the guard and fetches the token", async () => {
    const protocol: any = new McpCommunicationProtocol();
    const post = mock(async () => ({ data: { access_token: "tok", expires_in: 3600 } }));
    protocol._axiosInstance = { post };

    const token = await protocol._handleOAuth2(auth("https://auth.example.com/token"));
    expect(token).toBe("tok");
    expect(post).toHaveBeenCalled();
    // Credential POSTs must disable redirects so a 307/308 can't replay the
    // client secret to an unvalidated target.
    for (const call of post.mock.calls) {
      expect(call[2]).toMatchObject({ maxRedirects: 0 });
    }
  });

  test("a loopback plain-HTTP token URL passes the guard (local dev)", async () => {
    // Covers the loopback accept branch of ensureSecureMcpUrl (localhost /
    // 127.0.0.0/8 / 0.0.0.0 / ::ffff:127.x), which HTTPS alone doesn't exercise.
    const protocol: any = new McpCommunicationProtocol();
    const post = mock(async () => ({ data: { access_token: "tok", expires_in: 3600 } }));
    protocol._axiosInstance = { post };

    const token = await protocol._handleOAuth2(auth("http://127.0.0.1/token"));
    expect(token).toBe("tok");
    expect(post).toHaveBeenCalled();
  });
});
