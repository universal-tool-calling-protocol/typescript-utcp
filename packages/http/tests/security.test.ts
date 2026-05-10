// packages/http/tests/security.test.ts
//
// Tests for the URL trust-boundary helper used by every HTTP-based protocol.
// Backs the fix for GHSA-39j6-4867-gg4w / CVE-2026-44661 (SSRF via
// attacker-controlled OpenAPI specs). Pin accept/reject decisions so the
// historical bypass (`http://localhost.evil.com`) and the loopback-redirect
// variant cannot silently regress.

import { test, expect, describe } from 'bun:test';
// Import the package index first so its register() side effect runs before
// the converter tries to validate the generated HttpCallTemplate.
import '@utcp/http';
import { isSecureUrl, isLoopbackUrl, ensureSecureUrl } from '../src/_security';
import { OpenApiConverter } from '../src/openapi_converter';

describe('isSecureUrl', () => {
  test.each([
    'https://example.com/openapi.json',
    'HTTPS://example.com/openapi.json',
    'https://example.com:8443/v1/tool',
    'http://localhost/openapi.json',
    'http://localhost:8080/v1/tool',
    'http://127.0.0.1:9090/sensitive',
    'http://[::1]:9090/sensitive',
  ])('accepts %s', (url) => {
    expect(isSecureUrl(url)).toBe(true);
  });

  test.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://internal.service.local/secret',
    'http://10.0.0.5/admin',
    'http://example.com/openapi.json',
    'http://localhost.evil.com/path',
    'http://127.0.0.1.attacker.example/path',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'javascript:alert(1)',
    '',
    'not-a-url',
  ])('rejects %s', (url) => {
    expect(isSecureUrl(url)).toBe(false);
  });
});

describe('isLoopbackUrl', () => {
  test.each([
    'http://localhost/x',
    'http://localhost:9090/x',
    'http://127.0.0.1/x',
    'http://127.0.0.1:8080/x',
    'http://[::1]:9090/x',
    'https://localhost/x',
  ])('detects %s as loopback', (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  test.each([
    'https://example.com/x',
    'http://10.0.0.5/x',
    'http://example.com/x',
    'http://localhost.evil.com/x',
    'http://127.0.0.1.attacker.example/x',
    '',
    'not-a-url',
  ])('rejects %s as non-loopback', (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});

describe('ensureSecureUrl', () => {
  test('throws with context when url is insecure', () => {
    expect(() =>
      ensureSecureUrl('http://169.254.169.254/latest/meta-data/', 'tool invocation'),
    ).toThrow(/tool invocation/);
  });

  test('passes silently for valid url', () => {
    expect(() => ensureSecureUrl('https://example.com/v1/tool', 'manual discovery')).not.toThrow();
  });
});

describe('OpenApiConverter SSRF defense', () => {
  function specWithServer(serverUrl: string) {
    return {
      openapi: '3.0.0',
      info: { title: 'T' },
      servers: [{ url: serverUrl }],
      paths: {
        '/x': { get: { operationId: 'x', responses: { '200': { description: 'ok' } } } },
      },
    };
  }

  test('rejects loopback server from a remote spec', () => {
    const converter = new OpenApiConverter(specWithServer('http://127.0.0.1:9090'), {
      specUrl: 'https://attacker.example/openapi.json',
    });
    expect(() => converter.convert()).toThrow(/loopback/);
    expect(() => converter.convert()).toThrow(/GHSA-39j6-4867-gg4w/);
  });

  test('allows loopback server from a loopback spec (local-dev case)', () => {
    const converter = new OpenApiConverter(specWithServer('http://127.0.0.1:9090'), {
      specUrl: 'http://localhost:8000/openapi.json',
    });
    const manual = converter.convert();
    expect(manual.tools.length).toBe(1);
  });

  test('allows explicit base_url override even with remote spec', () => {
    const converter = new OpenApiConverter(specWithServer('http://127.0.0.1:9090'), {
      specUrl: 'https://attacker.example/openapi.json',
      baseUrl: 'http://127.0.0.1:9090',
    });
    const manual = converter.convert();
    expect(manual.tools.length).toBe(1);
  });

  test('allows remote spec with remote server (normal case)', () => {
    const converter = new OpenApiConverter(specWithServer('https://api.example.com'), {
      specUrl: 'https://api.example.com/openapi.json',
    });
    const manual = converter.convert();
    expect(manual.tools.length).toBe(1);
  });
});
