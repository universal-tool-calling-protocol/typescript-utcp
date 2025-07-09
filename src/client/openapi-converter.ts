import { Tool, ToolInputOutputSchema } from '../shared/tool';
import { UtcpManual } from '../shared/utcp-manual';
import { HttpProvider } from '../shared/provider';

/**
 * Converts an OpenAPI JSON specification into a UtcpManual.
 */
export class OpenApiConverter {
  private spec: Record<string, any>;

  /**
   * Creates a new OpenAPI converter instance
   * @param openapi_spec The OpenAPI specification object
   */
  constructor(openapi_spec: Record<string, any>) {
    this.spec = openapi_spec;
  }

  /**
   * Parses the OpenAPI specification and returns a UtcpManual.
   * @returns A UTCP manual containing tools derived from the OpenAPI specification
   */
  convert(): UtcpManual {
    const tools: Tool[] = [];
    const servers = this.spec.servers || [{ url: '/' }];
    const baseUrl = servers[0]?.url || '/';

    const paths = this.spec.paths || {};
    for (const [path, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
        if (['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
          const tool = this._createTool(path, method, operation, baseUrl);
          if (tool) {
            tools.push(tool);
          }
        }
      }
    }

    return {
      version: this.spec.info?.version || '1.0.0',
      tools
    };
  }

  /**
   * Resolves a local JSON reference.
   * @param ref The reference string (e.g. #/components/schemas/Pet)
   * @returns The resolved schema object
   */
  private _resolveRef(ref: string): Record<string, any> {
    if (!ref.startsWith('#/')) {
      throw new Error(`External or non-local references are not supported: ${ref}`);
    }

    const parts = ref.substring(2).split('/');
    let node = this.spec;
    
    for (const part of parts) {
      if (node[part] === undefined) {
        throw new Error(`Reference not found: ${ref}`);
      }
      node = node[part];
    }
    
    return node;
  }

  /**
   * Recursively resolves all $refs in a schema object.
   * @param schema The schema object that may contain references
   * @returns The resolved schema with all references replaced by their actual values
   */
  private _resolveSchema(schema: any): any {
    if (schema === null || typeof schema !== 'object') {
      return schema;
    }

    if (Array.isArray(schema)) {
      return schema.map(item => this._resolveSchema(item));
    }

    if ('$ref' in schema) {
      const resolvedRef = this._resolveRef(schema.$ref);
      return this._resolveSchema(resolvedRef);
    }

    const newSchema: Record<string, any> = {};
    for (const [key, value] of Object.entries(schema)) {
      newSchema[key] = this._resolveSchema(value);
    }
    
    return newSchema;
  }

  /**
   * Creates a Tool object from an OpenAPI operation.
   * @param path The API path
   * @param method The HTTP method (GET, POST, etc.)
   * @param operation The operation definition from OpenAPI
   * @param baseUrl The base URL from the servers array
   * @returns A Tool object or null if operationId is not defined
   */
  private _createTool(
    path: string, 
    method: string, 
    operation: Record<string, any>, 
    baseUrl: string
  ): Tool | null {
    const operationId = operation.operationId;
    if (!operationId) {
      return null;
    }

    const description = operation.summary || operation.description || '';
    const tags = operation.tags || [];

    const inputs = this._extractInputs(operation);
    const outputs = this._extractOutputs(operation);

    const providerName = this.spec.info?.title || 'openapi_provider';
    
    // Normalize the method to ensure it's valid for the enum
    const httpMethod = method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    
    // Properly concatenate the URL and path (ensuring no double slashes)
    const fullUrl = baseUrl.endsWith('/') && path.startsWith('/') 
      ? baseUrl + path.substring(1)
      : (!baseUrl.endsWith('/') && !path.startsWith('/')) 
        ? baseUrl + '/' + path
        : baseUrl + path;
    
    // Create provider without body_field and use type assertion
    // This works because the actual schema has default values
    const provider = {
      name: providerName,
      provider_type: 'http' as const,
      http_method: httpMethod,
      url: fullUrl,
      content_type: 'application/json',
      headers: {}
    } as HttpProvider;

    return {
      name: operationId,
      description,
      inputs,
      outputs,
      tags,
      provider
    };
  }

  /**
   * Extracts the input schema from an OpenAPI operation, resolving refs.
   * @param operation The OpenAPI operation object
   * @returns The input schema
   */
  private _extractInputs(operation: Record<string, any>): ToolInputOutputSchema {
    const properties: Record<string, any> = {};
    let required: string[] = [];

    // Handle parameters (path, query, header, cookie)
    for (const param of operation.parameters || []) {
      const resolvedParam = this._resolveSchema(param);
      const paramName = resolvedParam.name;
      
      if (paramName) {
        const schema = this._resolveSchema(resolvedParam.schema || {});
        properties[paramName] = {
          type: schema.type || 'string',
          description: resolvedParam.description || '',
          ...schema
        };
        
        if (resolvedParam.required) {
          required.push(paramName);
        }
      }
    }

    // Handle request body
    const requestBody = operation.requestBody;
    if (requestBody) {
      const resolvedBody = this._resolveSchema(requestBody);
      const content = resolvedBody.content || {};
      const jsonSchema = content['application/json']?.schema;
      
      if (jsonSchema) {
        const resolvedJsonSchema = this._resolveSchema(jsonSchema);
        
        if (resolvedJsonSchema.type === 'object' && resolvedJsonSchema.properties) {
          Object.assign(properties, resolvedJsonSchema.properties);
          
          if (resolvedJsonSchema.required) {
            required = [...required, ...resolvedJsonSchema.required];
          }
        }
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined
    };
  }

  /**
   * Extracts the output schema from an OpenAPI operation, resolving refs.
   * @param operation The OpenAPI operation object
   * @returns The output schema
   */
  private _extractOutputs(operation: Record<string, any>): ToolInputOutputSchema {
    const responses = operation.responses || {};
    const successResponse = responses['200'] || responses['201'];
    
    if (!successResponse) {
      return {
        type: 'object',
        properties: {}
      };
    }

    const resolvedResponse = this._resolveSchema(successResponse);
    const content = resolvedResponse.content || {};
    const jsonSchema = content['application/json']?.schema;

    if (!jsonSchema) {
      return {
        type: 'object',
        properties: {}
      };
    }

    const resolvedJsonSchema = this._resolveSchema(jsonSchema);
    
    return {
      type: resolvedJsonSchema.type || 'object',
      properties: resolvedJsonSchema.properties || {},
      required: resolvedJsonSchema.required
    };
  }
}
