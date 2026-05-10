// packages/cli/tests/security.test.ts
//
// Pin the fixes for the CLI protocol's two historical vulnerabilities:
//
//   - Command injection via unsanitized `tool_args` substitution in
//     `_substitute_utcp_args` (mirror of python-utcp's
//     GHSA-33p6-5jxp-p3x4).
//   - Full host environment leaked into the CLI subprocess via
//     `_prepare_environment` + `_executeShellScript`'s extra
//     `process.env` re-merge (mirror of python-utcp's
//     GHSA-5v57-8rxj-3p2r).
//
// As of @utcp/cli 1.1.1+, substitution is context-aware: it tracks the
// surrounding quote state in the template and emits a shell variable
// reference (`$VAR` / `${VAR}` / `$env:VAR`) for each placeholder, then
// carries the actual values to the subprocess via env vars. The shell
// expands them at runtime, AFTER parsing, so attacker-controlled bytes
// never enter the parser. Each invocation uses a fresh nonce so a
// template author cannot collide with our injection slot.

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { CliCommunicationProtocol } from '../src/cli_communication_protocol';
import { CliCallTemplate, CliCallTemplateSchema, CliCallTemplateSerializer } from '../src/cli_call_template';
import { IUtcpClient } from '@utcp/sdk';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

const mockClient = { root_dir: process.cwd() } as IUtcpClient;

// The protocol exposes these as private. Cast through `any` once so
// tests can drive them as unit-level helpers.
type Privates = {
  _substitute_utcp_args(
    command: string,
    toolArgs: Record<string, any>,
    nonce: string,
  ): { command: string; env: Record<string, string> };
  _prepare_environment(provider: CliCallTemplate): Record<string, string>;
  _default_inherited_keys(): readonly string[];
};
const proto = new CliCommunicationProtocol() as unknown as CliCommunicationProtocol & Privates;
const NONCE = 'TESTNONCE';
const expectedVar = (name: string) => `__UTCP_ARG_${NONCE}_${name}`;

const isWindows = process.platform === 'win32';


// ---------------------------------------------------------------------------
// Argument substitution must:
//   1. NOT splice attacker-controlled bytes into the parsed script.
//   2. Emit a reference whose form matches the surrounding quote context.
//   3. Carry the raw value via the returned env contribution.
// ---------------------------------------------------------------------------

describe('_substitute_utcp_args context-aware emission', () => {
  if (isWindows) {
    test('PowerShell: bare placeholder emits $env:VAR', () => {
      const { command, env } = proto._substitute_utcp_args(
        'mytool UTCP_ARG_x_UTCP_END',
        { x: 'a b' },
        NONCE,
      );
      expect(command).toBe(`mytool $env:${expectedVar('x')}`);
      expect(env[expectedVar('x')]).toBe('a b');
    });

    test('PowerShell: placeholder inside double-quoted string emits $env:VAR (PS expands inside dq)', () => {
      const { command, env } = proto._substitute_utcp_args(
        'Write-Output "Hi UTCP_ARG_x_UTCP_END!"',
        { x: 'a; rm /' },
        NONCE,
      );
      expect(command).toBe(`Write-Output "Hi $env:${expectedVar('x')}!"`);
      expect(env[expectedVar('x')]).toBe('a; rm /');
    });

    test('PowerShell: placeholder inside single-quoted string throws with clear message', () => {
      expect(() =>
        proto._substitute_utcp_args(
          "Write-Output 'Hi UTCP_ARG_x_UTCP_END'",
          { x: 'a' },
          NONCE,
        ),
      ).toThrow(/single-quoted/);
    });

    test('PowerShell: PS-style escaped backtick inside dq is preserved', () => {
      const { command } = proto._substitute_utcp_args(
        'Write-Output "pre `"x`" UTCP_ARG_a_UTCP_END"',
        { a: 'v' },
        NONCE,
      );
      // The dq state must still be active when the placeholder is hit.
      expect(command).toBe(`Write-Output "pre \`"x\`" $env:${expectedVar('a')}"`);
    });
  } else {
    test('bash: bare placeholder emits "$VAR" (quoted to prevent word-splitting)', () => {
      const { command, env } = proto._substitute_utcp_args(
        'mytool UTCP_ARG_x_UTCP_END',
        { x: 'a b' },
        NONCE,
      );
      expect(command).toBe(`mytool "$${expectedVar('x')}"`);
      expect(env[expectedVar('x')]).toBe('a b');
    });

    test('bash: placeholder inside double-quoted string emits ${VAR}', () => {
      const { command, env } = proto._substitute_utcp_args(
        'echo "Hi UTCP_ARG_x_UTCP_END!"',
        { x: 'a; rm /' },
        NONCE,
      );
      expect(command).toBe(`echo "Hi \${${expectedVar('x')}}!"`);
      expect(env[expectedVar('x')]).toBe('a; rm /');
    });

    test('bash: placeholder inside single-quoted string emits break-out form', () => {
      const { command, env } = proto._substitute_utcp_args(
        "echo 'Hi UTCP_ARG_x_UTCP_END!'",
        { x: 'a; rm /' },
        NONCE,
      );
      // Bash adjacent-quote concat: 'Hi '"$VAR"'!' -> single token 'Hi <value>!'.
      expect(command).toBe(`echo 'Hi '"$${expectedVar('x')}"'!'`);
      expect(env[expectedVar('x')]).toBe('a; rm /');
    });

    test('bash: backslash escape inside double quotes does not flip state', () => {
      // `echo "esc\" UTCP_ARG_a_UTCP_END"` -- the \" is escaped, dq remains
      // open, so the placeholder must emit the dq form (${VAR}).
      const { command } = proto._substitute_utcp_args(
        'echo "esc\\" UTCP_ARG_a_UTCP_END"',
        { a: 'v' },
        NONCE,
      );
      expect(command).toBe(`echo "esc\\" \${${expectedVar('a')}}"`);
    });
  }

  test('multiple placeholders share the same nonce namespace', () => {
    const { command, env } = proto._substitute_utcp_args(
      'cmd UTCP_ARG_a_UTCP_END UTCP_ARG_b_UTCP_END',
      { a: '1', b: '2' },
      NONCE,
    );
    expect(env[expectedVar('a')]).toBe('1');
    expect(env[expectedVar('b')]).toBe('2');
    expect(command).not.toMatch(/UTCP_ARG_[a-zA-Z0-9_]+_UTCP_END/);
  });

  test('missing arg is recorded as MISSING_ARG_<name> via env', () => {
    const { command, env } = proto._substitute_utcp_args(
      'cmd UTCP_ARG_x_UTCP_END',
      {},
      NONCE,
    );
    expect(env[expectedVar('x')]).toBe('MISSING_ARG_x');
    expect(command).not.toMatch(/UTCP_ARG_x_UTCP_END/);
  });

  test('attacker bytes never appear in the substituted command', () => {
    // The headline guarantee: even with payloads designed to break
    // every quote context, the SCRIPT contains only our reference and
    // the surrounding template chars. The bytes go into env.
    const payload = '"; rm -rf /; "';
    if (isWindows) {
      // PS dq form (sq throws, bare doesn't surround so doesn't apply)
      const { command, env } = proto._substitute_utcp_args(
        'Write-Output "URL=UTCP_ARG_id_UTCP_END"',
        { id: payload },
        NONCE,
      );
      expect(command).not.toContain('"; rm -rf /;');
      expect(command).not.toContain(';');
      expect(env[expectedVar('id')]).toBe(payload);
    } else {
      for (const tpl of [
        'curl UTCP_ARG_id_UTCP_END',
        'curl "https://api/UTCP_ARG_id_UTCP_END"',
        "curl 'https://api/UTCP_ARG_id_UTCP_END'",
      ]) {
        const { command, env } = proto._substitute_utcp_args(tpl, { id: payload }, NONCE);
        expect(command).not.toContain('rm -rf');
        expect(command).not.toContain(';');
        expect(env[expectedVar('id')]).toBe(payload);
      }
    }
  });

  test('nonce changes between invocations (non-deterministic env var name)', () => {
    // Drive the public path twice; the script must use different
    // env-var names each run so a template author can never pre-write
    // a literal `${__UTCP_ARG_<nonce>_x}` reference that collides.
    // We can't read the nonce from outside, but we can observe that
    // two runs with the same template+args produce different scripts.
    const tpl: CliCallTemplate = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo UTCP_ARG_x_UTCP_END' }],
    });
    const build = (proto as any)._build_combined_shell_script.bind(proto);
    const a = build(tpl.commands, { x: 'v' });
    const b = build(tpl.commands, { x: 'v' });
    expect(Object.keys(a.env)[0]).not.toBe(Object.keys(b.env)[0]);
  });
});


// ---------------------------------------------------------------------------
// Subprocess environment must NOT include arbitrary host vars.
// ---------------------------------------------------------------------------

describe('_prepare_environment', () => {
  const SECRET_KEYS = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'AZURE_CLIENT_SECRET',
    'GITHUB_TOKEN',
    'DATABASE_URL',
    'SLACK_TOKEN',
    'UTCP_TEST_FAKE_SECRET',
  ];

  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of SECRET_KEYS) {
      saved[k] = process.env[k];
      process.env[k] = `super-secret-${k}`;
    }
  });
  afterEach(() => {
    for (const k of SECRET_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  test('default (inherit_env_vars omitted) does not include arbitrary secrets', () => {
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
    });
    const env = proto._prepare_environment(provider);
    for (const k of SECRET_KEYS) {
      expect(env[k]).toBeUndefined();
    }
  });

  test('default propagates PATH and a home-directory variable', () => {
    process.env.PATH = process.env.PATH ?? '/usr/bin';
    if (isWindows) {
      process.env.USERPROFILE = process.env.USERPROFILE ?? 'C:\\Users\\x';
    } else {
      process.env.HOME = process.env.HOME ?? '/home/x';
    }
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
    });
    const env = proto._prepare_environment(provider);
    expect(env.PATH).toBeDefined();
    expect(isWindows ? env.USERPROFILE : env.HOME).toBeDefined();
  });

  test('explicit null matches default (does not flip to strict mode)', () => {
    const omitted = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
    });
    const explicit = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
      inherit_env_vars: null,
    });
    expect(proto._prepare_environment(omitted)).toEqual(
      proto._prepare_environment(explicit),
    );
  });

  test('inherit_env_vars: [] is strict mode (nothing inherited)', () => {
    process.env.PATH = '/usr/bin';
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
      inherit_env_vars: [],
    });
    const env = proto._prepare_environment(provider);
    expect(env).toEqual({});
  });

  test('inherit_env_vars: [] + env_vars yields only env_vars', () => {
    process.env.PATH = '/usr/bin';
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
      inherit_env_vars: [],
      env_vars: { FOO: 'bar' },
    });
    const env = proto._prepare_environment(provider);
    expect(env).toEqual({ FOO: 'bar' });
  });

  test('inherit_env_vars: explicit list replaces default allowlist', () => {
    process.env.PATH = '/usr/bin';
    process.env.UTCP_TEST_FAKE_SECRET = 'sk-x';
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
      inherit_env_vars: ['UTCP_TEST_FAKE_SECRET'],
    });
    const env = proto._prepare_environment(provider);
    expect(env).toEqual({ UTCP_TEST_FAKE_SECRET: 'sk-x' });
  });

  test('inherit_env_vars: unset names are skipped silently', () => {
    delete process.env.UTCP_TEST_DOES_NOT_EXIST;
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
      inherit_env_vars: ['UTCP_TEST_DOES_NOT_EXIST'],
    });
    const env = proto._prepare_environment(provider);
    expect(env.UTCP_TEST_DOES_NOT_EXIST).toBeUndefined();
  });

  test('env_vars override values inherited from the host', () => {
    process.env.PATH = '/usr/bin';
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
      env_vars: { PATH: '/custom/bin' },
    });
    const env = proto._prepare_environment(provider);
    expect(env.PATH).toBe('/custom/bin');
  });

  test('env_vars override inherit_env_vars too', () => {
    process.env.UTCP_TEST_FAKE_SECRET = 'host-value';
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
      inherit_env_vars: ['UTCP_TEST_FAKE_SECRET'],
      env_vars: { UTCP_TEST_FAKE_SECRET: 'explicit-override' },
    });
    const env = proto._prepare_environment(provider);
    expect(env.UTCP_TEST_FAKE_SECRET).toBe('explicit-override');
  });

  test('duplicate names in inherit_env_vars are idempotent', () => {
    process.env.UTCP_TEST_FAKE_SECRET = '1';
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
      inherit_env_vars: [
        'UTCP_TEST_FAKE_SECRET',
        'UTCP_TEST_FAKE_SECRET',
        'UTCP_TEST_FAKE_SECRET',
      ],
    });
    const env = proto._prepare_environment(provider);
    expect(env).toEqual({ UTCP_TEST_FAKE_SECRET: '1' });
  });

  test('explicit list does not pull other defaults along', () => {
    process.env.PATH = '/usr/bin';
    if (!isWindows) process.env.HOME = '/home/x';
    const provider = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'echo hi' }],
      inherit_env_vars: ['PATH'],
    });
    const env = proto._prepare_environment(provider);
    expect(env).toEqual({ PATH: '/usr/bin' });
  });
});


// ---------------------------------------------------------------------------
// Pydantic-equivalent: schema round-trip preserves null/[]/[...] tri-state.
// ---------------------------------------------------------------------------

describe('CliCallTemplate serialization preserves inherit_env_vars tri-state', () => {
  const ser = new CliCallTemplateSerializer();

  test('omitted field stays omitted-ish (not silently coerced to [])', () => {
    const tpl = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'x' }],
    });
    const d = ser.toDict(tpl);
    expect(d.inherit_env_vars === undefined || d.inherit_env_vars === null).toBe(true);
    const round = ser.validateDict(d);
    expect(round.inherit_env_vars === undefined || round.inherit_env_vars === null).toBe(true);
  });

  test('empty array survives round-trip', () => {
    const tpl = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'x' }],
      inherit_env_vars: [],
    });
    const d = ser.toDict(tpl);
    expect(d.inherit_env_vars).toEqual([]);
    const round = ser.validateDict(d);
    expect(round.inherit_env_vars).toEqual([]);
  });

  test('list of names survives round-trip', () => {
    const tpl = CliCallTemplateSchema.parse({
      call_template_type: 'cli',
      commands: [{ command: 'x' }],
      inherit_env_vars: ['PATH', 'OPENAI_API_KEY'],
    });
    const d = ser.toDict(tpl);
    expect(d.inherit_env_vars).toEqual(['PATH', 'OPENAI_API_KEY']);
    const round = ser.validateDict(d);
    expect(round.inherit_env_vars).toEqual(['PATH', 'OPENAI_API_KEY']);
  });
});


// ---------------------------------------------------------------------------
// End-to-end (Unix only -- bash payload assumptions). The headline
// regression we want to lock down: a placeholder INSIDE surrounding
// double quotes must not allow injection.
// ---------------------------------------------------------------------------

describe('end-to-end injection canaries (Unix only)', () => {
  if (isWindows) {
    test.skip('skipped on Windows (bash payload assumptions)', () => {});
    return;
  }

  test('attacker tool_arg cannot inject when placeholder is BARE', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'utcp-cli-sec-'));
    try {
      const canary = path.join(tmp, 'pwned-bare');
      const tpl = CliCallTemplateSchema.parse({
        call_template_type: 'cli',
        commands: [{ command: 'echo UTCP_ARG_v_UTCP_END' }],
        working_dir: tmp,
      });
      const result = await new CliCommunicationProtocol().callTool(
        mockClient,
        'echo_arg',
        { v: `benign; touch ${canary}` },
        tpl,
      );

      let canaryExists = false;
      try { await fs.access(canary); canaryExists = true; } catch {}
      expect(canaryExists).toBe(false);
      expect(String(result)).toContain('benign; touch');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('attacker tool_arg cannot inject when placeholder is INSIDE DOUBLE QUOTES', async () => {
    // The exact 1.1.1-bypass scenario: shlex.quote substitution would
    // splice `'"; rm /; "'` into a surrounding `"..."` and let the
    // attacker close the dq.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'utcp-cli-sec-dq-'));
    try {
      const canary = path.join(tmp, 'pwned-dq');
      const tpl = CliCallTemplateSchema.parse({
        call_template_type: 'cli',
        commands: [
          { command: `echo "URL=UTCP_ARG_id_UTCP_END"` },
        ],
        working_dir: tmp,
      });
      const payload = `"; touch ${canary}; "`;
      const result = await new CliCommunicationProtocol().callTool(
        mockClient,
        'echo_url',
        { id: payload },
        tpl,
      );

      let canaryExists = false;
      try { await fs.access(canary); canaryExists = true; } catch {}
      expect(canaryExists).toBe(false);
      // The literal payload should have appeared as part of the URL.
      expect(String(result)).toContain('URL=');
      expect(String(result)).toContain('touch');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('attacker tool_arg cannot inject when placeholder is INSIDE SINGLE QUOTES', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'utcp-cli-sec-sq-'));
    try {
      const canary = path.join(tmp, 'pwned-sq');
      const tpl = CliCallTemplateSchema.parse({
        call_template_type: 'cli',
        commands: [
          { command: `echo 'URL=UTCP_ARG_id_UTCP_END end'` },
        ],
        working_dir: tmp,
      });
      const payload = `'; touch ${canary}; '`;
      const result = await new CliCommunicationProtocol().callTool(
        mockClient,
        'echo_url',
        { id: payload },
        tpl,
      );

      let canaryExists = false;
      try { await fs.access(canary); canaryExists = true; } catch {}
      expect(canaryExists).toBe(false);
      expect(String(result)).toContain('URL=');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('host secret not in inherit_env_vars does not reach subprocess', async () => {
    const saved = process.env.UTCP_TEST_LEAK_PROBE;
    process.env.UTCP_TEST_LEAK_PROBE = 'should-not-leak';
    try {
      const tpl = CliCallTemplateSchema.parse({
        call_template_type: 'cli',
        commands: [
          { command: 'echo "probe=${UTCP_TEST_LEAK_PROBE:-MISSING}"' },
        ],
      });
      const result = await new CliCommunicationProtocol().callTool(
        mockClient,
        'leak_probe',
        {},
        tpl,
      );
      expect(String(result)).toContain('probe=MISSING');
      expect(String(result)).not.toContain('should-not-leak');
    } finally {
      if (saved === undefined) delete process.env.UTCP_TEST_LEAK_PROBE;
      else process.env.UTCP_TEST_LEAK_PROBE = saved;
    }
  });

  test('inherit_env_vars opts a host secret into the subprocess', async () => {
    const saved = process.env.UTCP_TEST_LEAK_PROBE;
    process.env.UTCP_TEST_LEAK_PROBE = 'inherited-value';
    try {
      const tpl = CliCallTemplateSchema.parse({
        call_template_type: 'cli',
        commands: [
          { command: 'echo "probe=${UTCP_TEST_LEAK_PROBE:-MISSING}"' },
        ],
        inherit_env_vars: ['PATH', 'UTCP_TEST_LEAK_PROBE'],
      });
      const result = await new CliCommunicationProtocol().callTool(
        mockClient,
        'leak_probe',
        {},
        tpl,
      );
      expect(String(result)).toContain('probe=inherited-value');
    } finally {
      if (saved === undefined) delete process.env.UTCP_TEST_LEAK_PROBE;
      else process.env.UTCP_TEST_LEAK_PROBE = saved;
    }
  });
});
