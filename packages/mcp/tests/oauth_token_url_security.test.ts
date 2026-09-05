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

  const freshProtocol = () => {
    const protocol: any = new McpCommunicationProtocol();
    const post = mock(async () => ({ data: { access_token: "tok", expires_in: 3600 } }));
    protocol._axiosInstance = { post };
    return { protocol, post };
  };

  // Each form is rejected by a different branch of the guard: a remote
  // plain-HTTP host, a host that only looks loopback by prefix, and a
  // non-HTTP(S)/WS scheme.
  const insecureForms = [
    "http://attacker.example/token",
    "http://127.0.0.1.attacker.example/token",
    "ftp://127.0.0.1/token",
  ];
  for (const url of insecureForms) {
    test(`rejects ${url} without ever posting credentials`, async () => {
      const { protocol, post } = freshProtocol();
      await expect(protocol._handleOAuth2(auth(url))).rejects.toThrow("Security error");
      // The guard must run before any request: the credential POST is never made.
      expect(post).toHaveBeenCalledTimes(0);
    });
  }

  test("a secure HTTPS token URL passes the guard and fetches the token", async () => {
    const { protocol, post } = freshProtocol();
    const token = await protocol._handleOAuth2(auth("https://auth.example.com/token"));
    expect(token).toBe("tok");
    expect(post).toHaveBeenCalled();
    // Credential POSTs must disable redirects so a 307/308 can't replay the
    // client secret to an unvalidated target.
    for (const call of post.mock.calls) {
      expect(call[2]).toMatchObject({ maxRedirects: 0 });
    }
  });

  // Each loopback form exercises a different accept branch of the guard:
  //   localhost / 127.0.0.1  -> the hostname set
  //   127.0.0.2              -> the 127.0.0.0/8 IPv4 range
  //   0.0.0.0                -> the wildcard address
  //   [::ffff:127.0.0.1]     -> IPv4-mapped IPv6 loopback
  const loopbackForms = [
    "http://localhost/token",
    "http://127.0.0.1/token",
    "http://127.0.0.2/token",
    "http://0.0.0.0/token",
    "http://[::ffff:127.0.0.1]/token",
  ];
  for (const url of loopbackForms) {
    test(`loopback token URL passes the guard (local dev): ${url}`, async () => {
      const { protocol, post } = freshProtocol();
      const token = await protocol._handleOAuth2(auth(url));
      expect(token).toBe("tok");
      expect(post).toHaveBeenCalled();
    });
  }

  test("concurrent first-time token fetches are coalesced into one request", async () => {
    const protocol: any = new McpCommunicationProtocol();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    protocol._fetchOAuth2Token = async (a: any) => {
      calls += 1;
      await gate;
      const token = { accessToken: "tok", expiresAt: Date.now() + 3_600_000 };
      protocol._oauthTokens.set(protocol._oauthCacheKey(a), token);
      return token;
    };

    // All five callers are started synchronously and attach to the shared fetch
    // before it is released.
    const pending = Promise.all(
      [0, 1, 2, 3, 4].map(() => protocol._handleOAuth2(auth("https://auth.example.com/token")))
    );
    release();
    const results = await pending;

    expect(results).toEqual(["tok", "tok", "tok", "tok", "tok"]);
    expect(calls).toBe(1);
  });
});
