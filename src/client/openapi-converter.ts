import { Tool, ToolInputOutputSchema } from '../shared/tool';
import { UtcpManual, UtcpManualSchema } from '../shared/utcp-manual';
import { HttpProvider, HttpProviderSchema } from '../shared/provider';
import { Auth, ApiKeyAuthSchema, BasicAuthSchema, OAuth2AuthSchema } from '../shared/auth';

interface OpenApiConverterOptions {
  specUrl?: string;
  providerName?: string;
}

/**
 * Converts an OpenAPI JSON specification into a UtcpManual.
 */
export class OpenApiConverter {
  private spec: Record<string, any>;
  private specUrl: string | undefined;
  private providerName: string;

  /**
   * Creates a new OpenAPI converter instance
   * @param openapi_spec The OpenAPI specification object
   * @param options Optional settings, like the specUrl
   */
  constructor(openapi_spec: Record<string, any>, options?: OpenApiConverterOptions) {
    this.spec = openapi_spec;
    this.specUrl = options?.specUrl;
    
    // If providerName is not provided, get the first word in spec.info.title
    if (!options?.providerName) {
      const title = openapi_spec.info?.title || 'openapi_provider';
      // Replace characters that are invalid for identifiers
      const invalidChars = " -.,!?'\"\\/()[]{}#@$%^&*+=~`|;:<>";
      this.providerName = title
        .split('')
        .map((c: string) => invalidChars.includes(c) ? '_' : c)
        .join('');
    } else {
      this.providerName = options.providerName;
    }
  }

  /**
   * Parses the OpenAPI specification and returns a UtcpManual.
   * @returns A UTCP manual containing tools derived from the OpenAPI specification
   */
  convert(): UtcpManual {
    const tools: Tool[] = [];
    let baseUrl = '/';

    const servers = this.spec.servers;
    if (servers && Array.isArray(servers) && servers.length > 0 && servers[0].url) {
        baseUrl = servers[0].url;
    } else if (this.specUrl) {
        try {
            const parsedUrl = new URL(this.specUrl);
            baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
        } catch (e) {
            console.error(`Invalid specUrl provided: ${this.specUrl}`);
        }
    } else {
        console.error("No server info or spec URL provided. Using fallback base URL: / ");
    }

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

    return UtcpManualSchema.parse({ tools });
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

    const { inputs, header_fields, body_field } = this._extractInputs(operation);
    const outputs = this._extractOutputs(operation);
    const auth = this._extractAuth(operation);

    const providerName = this.spec.info?.title || 'openapi_provider';
    
    const fullUrl = `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

    const provider = HttpProviderSchema.parse({
      name: providerName,
      provider_type: 'http',
      http_method: method.toUpperCase(),
      url: fullUrl,
      body_field: body_field || undefined,
      header_fields: header_fields.length > 0 ? header_fields : undefined,
      auth
    });

    return {
      name: operationId,
      description,
      inputs,
      outputs,
      tags,
      tool_provider: provider
    };
  }

  /**
   * Extracts the input schema from an OpenAPI operation, resolving refs.
   * @param operation The OpenAPI operation object
   * @returns The input schema, header fields, and body field
   */
  private _extractInputs(operation: Record<string, any>): { inputs: ToolInputOutputSchema; header_fields: string[]; body_field: string | null } {
    const properties: Record<string, any> = {};
    let required: string[] = [];
    const header_fields: string[] = [];
    let body_field: string | null = null;

    // Handle parameters (path, query, header, cookie)
    for (const param of operation.parameters || []) {
      const resolvedParam = this._resolveSchema(param);
      const paramName = resolvedParam.name;
      
      if (paramName) {
        if (resolvedParam.in === 'header') {
            header_fields.push(paramName);
        }

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
        body_field = 'body';
        properties[body_field] = {
            description: resolvedBody.description || 'Request body',
            ...this._resolveSchema(jsonSchema),
        };
        if (resolvedBody.required) {
            required.push(body_field);
        }
      }
    }

    const inputs = ToolInputOutputSchema.parse({
      properties,
      required: required.length > 0 ? required : undefined
    });

    return { inputs, header_fields, body_field };
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
      return ToolInputOutputSchema.parse({});
    }

    const resolvedResponse = this._resolveSchema(successResponse);
    const content = resolvedResponse.content || {};
    const jsonSchema = content['application/json']?.schema;

    if (!jsonSchema) {
      return ToolInputOutputSchema.parse({});
    }

    const resolvedJsonSchema = this._resolveSchema(jsonSchema);
    
    const schemaArgs: Record<string, any> = {
      type: resolvedJsonSchema.type || 'object',
      properties: resolvedJsonSchema.properties || {},
      required: resolvedJsonSchema.required,
      description: resolvedJsonSchema.description,
      title: resolvedJsonSchema.title
    };
    
    // Handle array item types
    if (schemaArgs.type === 'array' && 'items' in resolvedJsonSchema) {
      schemaArgs.items = resolvedJsonSchema.items;
    }
    
    // Handle additional schema attributes
    for (const attr of ['enum', 'minimum', 'maximum', 'format']) {
      if (attr in resolvedJsonSchema) {
        schemaArgs[attr] = resolvedJsonSchema[attr];
      }
    }
    
    return ToolInputOutputSchema.parse(schemaArgs);
  }

  /**
   * Extracts authentication information from OpenAPI operation and global security schemes.
   * @param operation The OpenAPI operation object
   * @returns An Auth object or undefined if no authentication is specified
   */
  private _extractAuth(operation: Record<string, any>): Auth | undefined {
    // First check for operation-level security requirements
    let securityRequirements = operation.security || [];
    
    // If no operation-level security, check global security requirements
    if (!securityRequirements.length) {
      securityRequirements = this.spec.security || [];
    }
    
    // If no security requirements, return undefined
    if (!securityRequirements.length) {
      return undefined;
    }
    
    // Get security schemes - support both OpenAPI 2.0 and 3.0
    const securitySchemes = this._getSecuritySchemes();
    
    // Process the first security requirement (most common case)
    // Each security requirement is a dict with scheme name as key
    for (const securityReq of securityRequirements) {
      for (const [schemeName, scopes] of Object.entries(securityReq)) {
        if (schemeName in securitySchemes) {
          const scheme = securitySchemes[schemeName];
          return this._createAuthFromScheme(scheme, schemeName);
        }
      }
    }
    
    return undefined;
  }
  
  /**
   * Gets security schemes supporting both OpenAPI 2.0 and 3.0.
   * @returns A record of security schemes
   */
  private _getSecuritySchemes(): Record<string, any> {
    // OpenAPI 3.0 format
    if ('components' in this.spec) {
      return this.spec.components?.securitySchemes || {};
    }
    
    // OpenAPI 2.0 format
    return this.spec.securityDefinitions || {};
  }
  
  /**
   * Creates an Auth object from an OpenAPI security scheme.
   * @param scheme The security scheme object
   * @param schemeName The name of the scheme
   * @returns An Auth object or undefined if the scheme is not supported
   */
  private _createAuthFromScheme(scheme: Record<string, any>, schemeName: string): Auth | undefined {
    const schemeType = (scheme.type || '').toLowerCase();

    if (schemeType === 'apikey') {
      const location = scheme.in || 'header';
      const paramName = scheme.name || 'Authorization';
      return ApiKeyAuthSchema.parse({
        auth_type: 'api_key',
        api_key: `\$${this.providerName.toUpperCase()}_API_KEY`,
        var_name: paramName,
        location,
      });
    }

    if (schemeType === 'basic') {
      return BasicAuthSchema.parse({
        auth_type: 'basic',
        username: `\$${this.providerName.toUpperCase()}_USERNAME`,
        password: `\$${this.providerName.toUpperCase()}_PASSWORD`,
      });
    }

    if (schemeType === 'http') {
      const httpScheme = (scheme.scheme || '').toLowerCase();
      if (httpScheme === 'basic') {
        return BasicAuthSchema.parse({
          auth_type: 'basic',
          username: `\$${this.providerName.toUpperCase()}_USERNAME`,
          password: `\$${this.providerName.toUpperCase()}_PASSWORD`,
        });
      } else if (httpScheme === 'bearer') {
        return ApiKeyAuthSchema.parse({
          auth_type: 'api_key',
          api_key: `Bearer \$${this.providerName.toUpperCase()}_API_KEY`,
          var_name: 'Authorization',
          location: 'header',
        });
      }
    }

    if (schemeType === 'oauth2') {
      const flows = scheme.flows || {};

      // OpenAPI 3.0 format
      if (Object.keys(flows).length > 0) {
        for (const [flowType, flowConfig] of Object.entries(flows)) {
          if (['authorizationCode', 'accessCode', 'clientCredentials', 'application'].includes(flowType)) {
            const tokenUrl = (flowConfig as Record<string, any>).tokenUrl;
            if (tokenUrl) {
              const scopes = (flowConfig as Record<string, any>).scopes || {};
              return OAuth2AuthSchema.parse({
                auth_type: 'oauth2',
                token_url: tokenUrl,
                client_id: `\$${this.providerName.toUpperCase()}_CLIENT_ID`,
                client_secret: `\$${this.providerName.toUpperCase()}_CLIENT_SECRET`,
                scope: Object.keys(scopes).length > 0 ? Object.keys(scopes).join(' ') : undefined,
              });
            }
          }
        }
      }
      // OpenAPI 2.0 format
      else {
        const flowType = scheme.flow || '';
        const tokenUrl = scheme.tokenUrl;
        if (tokenUrl && ['accessCode', 'application', 'clientCredentials'].includes(flowType)) {
          return OAuth2AuthSchema.parse({
            auth_type: 'oauth2',
            token_url: tokenUrl,
            client_id: `\$${this.providerName.toUpperCase()}_CLIENT_ID`,
            client_secret: `\$${this.providerName.toUpperCase()}_CLIENT_SECRET`,
            scope: Object.keys(scheme.scopes || {}).length > 0 ? Object.keys(scheme.scopes || {}).join(' ') : undefined,
          });
        }
      }
    }

    return undefined;
  }
}
