// packages/http/tests/openapi_converter.test.ts
//
// Tests for OpenAPI -> UTCP conversion of examples and HTTP method handling.
// Mirrors the Python suite: parameter/body/response examples are extracted and
// normalized into the JSON Schema `examples` keyword, schema-level examples are
// merged (not leaked raw), and operations with unsupported HTTP methods are
// skipped rather than producing invalid tools.

import { test, expect, describe, spyOn } from 'bun:test';
// Import the package index first so its register() side effect runs before the
// converter validates the generated HttpCallTemplate.
import '@utcp/http';
import { OpenApiConverter } from '../src/openapi_converter';

describe('OpenApiConverter examples', () => {
  test('extracts parameter, body, and response examples', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/users/{userId}': {
          get: {
            operationId: 'getUser',
            parameters: [
              {
                name: 'userId',
                in: 'path',
                description: 'ID of the user',
                required: true,
                schema: { type: 'string' },
                example: 'user123',
              },
              {
                name: 'includeDetails',
                in: 'query',
                required: false,
                schema: { type: 'boolean' },
                examples: {
                  trueExample: { summary: 'Include details', value: true },
                  falseExample: { summary: 'Exclude details', value: false },
                },
              },
            ],
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' }, name: { type: 'string' } },
                    },
                    examples: {
                      userExample: {
                        summary: 'Example user',
                        value: { id: 'user123', name: 'John Doe' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              description: 'User to create',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' }, email: { type: 'string' } },
                    required: ['name', 'email'],
                  },
                  examples: {
                    newUser: {
                      summary: 'New user example',
                      value: { name: 'Jane Smith', email: 'jane@example.com' },
                    },
                  },
                },
              },
            },
            responses: { '201': { description: 'User created' } },
          },
        },
      },
    };

    const manual = new OpenApiConverter(spec).convert();
    expect(manual.tools.length).toBe(2);

    const getUser = manual.tools.find(t => t.name === 'getUser')!;
    expect(getUser).toBeDefined();

    const userId = getUser.inputs.properties!.userId;
    expect(userId.examples).toEqual(['user123']);

    const includeDetails = getUser.inputs.properties!.includeDetails;
    expect(includeDetails.examples).toEqual([true, false]);

    expect(getUser.outputs.examples).toEqual([{ id: 'user123', name: 'John Doe' }]);

    const createUser = manual.tools.find(t => t.name === 'createUser')!;
    const body = createUser.inputs.properties!.body;
    expect(body.examples).toEqual([{ name: 'Jane Smith', email: 'jane@example.com' }]);
  });

  test('normalizes schema-level examples and does not leak raw keys', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/widgets': {
          post: {
            operationId: 'createWidget',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    example: { name: 'Widget A' },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                      example: { id: 'w_1' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const manual = new OpenApiConverter(spec).convert();
    const tool = manual.tools.find(t => t.name === 'createWidget')!;

    const body = tool.inputs.properties!.body;
    expect(body.examples).toEqual([{ name: 'Widget A' }]);
    // raw 'example' key must not leak through onto the property
    expect('example' in body).toBe(false);

    expect(tool.outputs.examples).toEqual([{ id: 'w_1' }]);
  });

  test('preserves array-form (JSON Schema / OAS 3.1) schema examples', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/gadgets': {
          post: {
            operationId: 'createGadget',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    // JSON Schema 'examples' keyword: an array of values
                    examples: [{ name: 'Gadget A' }, { name: 'Gadget B' }],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                      examples: ['ok', 'done'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const manual = new OpenApiConverter(spec).convert();
    const tool = manual.tools.find(t => t.name === 'createGadget')!;

    const body = tool.inputs.properties!.body;
    expect(body.examples).toEqual([{ name: 'Gadget A' }, { name: 'Gadget B' }]);
    expect(tool.outputs.examples).toEqual(['ok', 'done']);
  });

  test('skips operations with unsupported HTTP methods', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/things': {
          get: { operationId: 'listThings', responses: { '200': { description: 'ok' } } },
          options: { operationId: 'optionsThings', responses: { '200': { description: 'ok' } } },
          head: { operationId: 'headThings', responses: { '200': { description: 'ok' } } },
          trace: { operationId: 'traceThings', responses: { '200': { description: 'ok' } } },
        },
      },
    };

    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const manual = new OpenApiConverter(spec).convert();
      const names = manual.tools.map(t => t.name).sort();
      expect(names).toEqual(['listThings']);

      // Unsupported operations must reach _createTool and emit a skip warning,
      // not be silently dropped by the loop filter.
      const warnings = warn.mock.calls.map(c => String(c[0])).join('\n');
      expect(warnings).toContain('optionsThings');
      expect(warnings).toContain('headThings');
      expect(warnings).toContain('traceThings');
    } finally {
      warn.mockRestore();
    }
  });
});
