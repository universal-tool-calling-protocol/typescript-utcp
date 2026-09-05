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

  // The usability rule is positive (non-empty visible ASCII), so every shape
  // that cannot be a valid `Authorization: Bearer <token>` header is rejected
  // by one rule. Each case here fails if the VCHAR requirement is removed.
  const unusableTokens: Array<[string, unknown]> = [
    ["a number", 12345],
    ["an empty string", ""],
    ["an embedded space", "tok en"],
    ["a CR/LF (header injection)", "tok\r\nen"],
    ["a NUL/control character", "tok\u0000en"],
    ["non-ASCII", "tok\u00e9n"],
  ];
  for (const [label, value] of unusableTokens) {
    test(`an access_token that is ${label} is a failed fetch and is never cached`, async () => {
      const protocol: any = new McpCommunicationProtocol();
      protocol._axiosInstance = { post: async () => ({ data: { access_token: value, expires_in: 3600 } }) };

      await expect(protocol._handleOAuth2(auth("https://auth.example.com/token"))).rejects.toThrow("usable");
      expect(protocol._oauthTokens.size).toBe(0);
      expect(protocol._oauthInflight.size).toBe(0); // the failed fetch released its slot
    });
  }

  test("a token of printable punctuation is accepted (the rule must not over-reject real tokens)", async () => {
    // Guards the opposite failure: tightening to RFC 6750's b64token alphabet
    // would reject legitimate opaque tokens containing e.g. ':'.
    const protocol: any = new McpCommunicationProtocol();
    const value = "a.b-c_d~e+f/g=:h";
    protocol._axiosInstance = { post: async () => ({ data: { access_token: value, expires_in: 3600 } }) };

    expect(await protocol._handleOAuth2(auth("https://auth.example.com/token"))).toBe(value);
  });
});

describe("McpCommunicationProtocol OAuth2 in-flight identity lifecycle", () => {
  // The in-flight entry is the sole authority for who may write the cache. A
  // fetch caches only if it is still the current entry when it lands, and
  // removes itself only if still current. There is no version counter.
  const auth = { auth_type: "oauth2", token_url: "https://x/token", client_id: "cid", client_secret: "s", scope: "" };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const tok = (v: string) => ({ accessToken: v, expiresAt: Date.now() + 3_600_000 });
  const cached = (protocol: any) => protocol._oauthTokens.get(protocol._oauthCacheKey(auth))?.accessToken;

  test("invalidating with nothing in flight leaves no state behind", () => {
    const protocol: any = new McpCommunicationProtocol();
    protocol._invalidateOAuthToken(auth);
    expect(protocol._oauthInflight.size).toBe(0);
    expect(protocol._oauthTokens.size).toBe(0);
  });

  test("a settled fetch caches and removes its own in-flight entry", async () => {
    const protocol: any = new McpCommunicationProtocol();
    protocol._axiosInstance = { post: async () => ({ data: { access_token: "tok", expires_in: 3600 } }) };
    expect(await protocol._handleOAuth2(auth)).toBe("tok");
    expect(protocol._oauthInflight.size).toBe(0);
    expect(cached(protocol)).toBe("tok");
  });

  test("a fetch invalidated mid-flight (even twice) never caches its stale result", async () => {
    const protocol: any = new McpCommunicationProtocol();
    let resolveFetch!: (v: any) => void;
    const pending = new Promise<any>((res) => { resolveFetch = res; });
    protocol._axiosInstance = { post: () => pending };

    const fetching = protocol._handleOAuth2(auth);
    protocol._invalidateOAuthToken(auth);
    protocol._invalidateOAuthToken(auth); // a second rejection before the fetch lands
    resolveFetch({ data: { access_token: "stale", expires_in: 3600 } });

    await expect(fetching).resolves.toBe("stale"); // the caller still gets a token...
    expect(protocol._oauthTokens.size).toBe(0);     // ...but nothing is cached
    expect(protocol._oauthInflight.size).toBe(0);
  });

  test("a superseded fetch settling AFTER its replacement cannot repopulate the cache", async () => {
    // The generation-counter design broke exactly here: the replacement
    // settling first pruned the counter while the older fetch was still
    // running, and that older fetch then cached its stale token.
    const protocol: any = new McpCommunicationProtocol();
    const gates: Array<(v: any) => void> = [];
    protocol._fetchOAuth2Token = () => new Promise((res) => gates.push(res));

    const first = protocol._handleOAuth2(auth);   // fetch #1 is the current entry
    protocol._invalidateOAuthToken(auth);          // entry dropped; fetch #1 keeps running
    const second = protocol._handleOAuth2(auth);  // fetch #2 becomes the current entry
    expect(gates.length).toBe(2);

    gates[1](tok("fresh"));                        // the replacement settles FIRST
    expect(await second).toBe("fresh");
    expect(cached(protocol)).toBe("fresh");

    gates[0](tok("stale"));                        // the superseded fetch settles LAST
    expect(await first).toBe("stale");             // its caller still receives a token...
    await tick();
    expect(cached(protocol)).toBe("fresh");        // ...but it was not current, so the cache kept "fresh"
    expect(protocol._oauthInflight.size).toBe(0);
  });

  test("close() drops in-flight entries so a fetch landing afterwards does not cache", async () => {
    const protocol: any = new McpCommunicationProtocol();
    let resolveFetch!: (v: any) => void;
    const pending = new Promise<any>((res) => { resolveFetch = res; });
    protocol._axiosInstance = { post: () => pending };

    const fetching = protocol._handleOAuth2(auth);
    await protocol.close();                        // entry dropped mid-fetch
    resolveFetch({ data: { access_token: "late", expires_in: 3600 } });

    await expect(fetching).resolves.toBe("late");
    expect(protocol._oauthTokens.size).toBe(0);    // the drain left no credential behind
    expect(protocol._oauthInflight.size).toBe(0);
  });
});
