// packages/http/src/http_communication_protocol.ts
import axios, { AxiosInstance, AxiosRequestConfig, Method } from 'axios';
import * as yaml from 'js-yaml';
import { CommunicationProtocol } from '@utcp/sdk';
import { RegisterManualResult } from '@utcp/sdk';
import { CallTemplate } from '@utcp/sdk';
import { Tool } from '@utcp/sdk';
import { UtcpManualSchema } from '@utcp/sdk';
import { ApiKeyAuth } from '@utcp/sdk'; 
import { BasicAuth } from '@utcp/sdk';
import { OAuth2Auth } from '@utcp/sdk';
import { IUtcpClient } from '@utcp/sdk'; 
import { HttpCallTemplateSchema, HttpCallTemplate } from './http_call_template';
import { OpenApiConverter } from './openapi_converter';

/**
 * HTTP communication protocol implementation for UTCP client.
 *
 * Handles communication with HTTP-based tool providers, supporting various
 * authentication methods, URL path parameters, and automatic tool discovery.
 * Enforces security by requiring HTTPS or localhost connections.
 */
export class HttpCommunicationProtocol implements CommunicationProtocol {
  private _oauthTokens: Map<string, { accessToken: string; expiresAt: number }> = new Map();
  private _axiosInstance: AxiosInstance;

  constructor() {
    this._axiosInstance = axios.create({
      timeout: 30000,
    });
  }

  private _logInfo(message: string): void {
    console.log(`[HttpCommunicationProtocol] ${message}`);
  }

  private _logError(message: string, error?: any): void {
    console.error(`[HttpCommunicationProtocol Error] ${message}`, error);
  }

  /**
   * Registers a manual and its tools from an HTTP provider.
   * Supports UTCP Manuals directly or OpenAPI specifications which are converted.
   *
   * @param caller The UTCP client instance.
   * @param manualCallTemplate The HTTP call template for discovery.
   * @returns A RegisterManualResult object.
   */
  public async registerManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<RegisterManualResult> {
    const httpCallTemplate = HttpCallTemplateSchema.parse(manualCallTemplate);

    try {
      const url = httpCallTemplate.url;

      if (!url.startsWith('https://') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
        throw new Error(
          `Security error: URL must use HTTPS or start with 'http://localhost' or 'http://127.0.0.1'. Got: ${url}. ` +
          "Non-secure URLs are vulnerable to man-in-the-middle attacks."
        );
      }

      this._logInfo(`Discovering tools from '${httpCallTemplate.name}' (HTTP) at ${url}`);

      const requestConfig: AxiosRequestConfig = {
        method: httpCallTemplate.http_method as Method,
        url: url,
        headers: { ...httpCallTemplate.headers },
        params: {},
        data: undefined,
        auth: undefined,
        timeout: 10000
      };

      await this._applyAuthToRequestConfig(httpCallTemplate, requestConfig);
      const response = await this._axiosInstance.request(requestConfig);
      const contentType = response.headers['content-type'] || '';
      let responseData: any;

      if (contentType.includes('yaml') || url.endsWith('.yaml') || url.endsWith('.yml')) {
        responseData = yaml.load(response.data);
      } else {
        responseData = response.data;
      }

      let utcpManual;
      if (responseData && responseData.utcp_version && Array.isArray(responseData.tools)) {
        this._logInfo(`Detected UTCP manual from '${httpCallTemplate.name}'.`);
        utcpManual = UtcpManualSchema.parse(responseData);
      } else if (responseData && (responseData.openapi || responseData.swagger || responseData.paths)) {
        this._logInfo(`Assuming OpenAPI spec from '${httpCallTemplate.name}'. Converting to UTCP manual.`);
        const converter = new OpenApiConverter(responseData, {
          specUrl: httpCallTemplate.url,
          callTemplateName: httpCallTemplate.name
        });
        utcpManual = converter.convert();
      } else {
        throw new Error("Response is neither a valid UTCP Manual nor an OpenAPI Specification.");
      }

      const toolsInManual: Tool[] = utcpManual.tools;
      if (toolsInManual.length > 0) {
        this._logInfo(`Found ${toolsInManual.length} tools.`);
      }

      return {
        manualCallTemplate: httpCallTemplate,
        manual: utcpManual,
        success: true,
        errors: []
      };

    } catch (error: any) {
      this._logError(`Error discovering tools from HTTP provider '${httpCallTemplate.name}':`, error);
      return {
        manualCallTemplate: httpCallTemplate,
        manual: UtcpManualSchema.parse({ tools: [] }),
        success: false,
        errors: [axios.isAxiosError(error) ? error.message : String(error)]
      };
    }
  }

  /**
   * Deregisters an HTTP manual. This is a no-op for stateless HTTP communication.
   * @param caller The UTCP client instance.
   * @param manualCallTemplate The HTTP call template to deregister.
   */
  public async deregisterManual(caller: IUtcpClient, manualCallTemplate: CallTemplate): Promise<void> {
    this._logInfo(`Deregistering HTTP manual '${manualCallTemplate.name}' (no-op).`);
    return Promise.resolve();
  }

  /**
   * Executes a tool call through the HTTP protocol.
   *
   * @param caller The UTCP client instance.
   * @param toolName Name of the tool to call.
   * @param toolArgs Dictionary of arguments to pass to the tool.
   * @param toolCallTemplate The HTTP call template for the tool.
   * @returns The tool's response.
   */
  public async callTool(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): Promise<any> {
    const httpCallTemplate = HttpCallTemplateSchema.parse(toolCallTemplate);

    const requestHeaders: Record<string, string> = { ...httpCallTemplate.headers };
    let bodyContent: any = undefined;
    const remainingArgs = { ...toolArgs };
    const queryParams: Record<string, any> = {};

    if (httpCallTemplate.header_fields) {
      for (const fieldName of httpCallTemplate.header_fields) {
        if (fieldName in remainingArgs) {
          requestHeaders[fieldName] = String(remainingArgs[fieldName]);
          delete remainingArgs[fieldName];
        }
      }
    }

    if (httpCallTemplate.body_field && httpCallTemplate.body_field in remainingArgs) {
      bodyContent = remainingArgs[httpCallTemplate.body_field];
      delete remainingArgs[httpCallTemplate.body_field];
    }

    const url = this._buildUrlWithPathParams(httpCallTemplate.url, remainingArgs);

    Object.assign(queryParams, remainingArgs);

    const requestConfig: AxiosRequestConfig = {
      method: httpCallTemplate.http_method as Method,
      url: url,
      headers: requestHeaders,
      params: queryParams,
      data: bodyContent,
      auth: undefined,
      timeout: httpCallTemplate.timeout
    };

    await this._applyAuthToRequestConfig(httpCallTemplate, requestConfig);

    try {
      if (bodyContent !== undefined && !('Content-Type' in (requestConfig.headers || {}))) {
        requestConfig.headers = {
          ...(requestConfig.headers || {}),
          'Content-Type': httpCallTemplate.content_type,
        };
      }

      this._logInfo(`Executing HTTP tool '${toolName}' with URL: ${requestConfig.url} and method: ${requestConfig.method}`);
      const response = await this._axiosInstance.request(requestConfig);

      const contentType = response.headers['content-type'] || '';
      if (contentType.includes('yaml') || url.endsWith('.yaml') || url.endsWith('.yml')) {
        return yaml.load(response.data);
      }
      return response.data;
    } catch (error: any) {
      this._logError(`Error calling HTTP tool '${toolName}':`, error);
      throw error;
    }
  }

  /**
   * Executes a tool call through this transport streamingly.
   * For standard HTTP, this typically means fetching the full response and yielding it as a single chunk.
   * Real streaming for protocols like SSE or HTTP chunked transfer would be in their specific implementations.
   *
   * @param caller The UTCP client instance.
   * @param toolName Name of the tool to call.
   * @param toolArgs Dictionary of arguments to pass to the tool.
   * @param toolCallTemplate The HTTP call template for the tool.
   * @returns An async generator that yields chunks of the tool's response.
   */
  public async *callToolStreaming(caller: IUtcpClient, toolName: string, toolArgs: Record<string, any>, toolCallTemplate: CallTemplate): AsyncGenerator<any, void, unknown> {
    this._logInfo(`HTTP protocol does not inherently support streaming for '${toolName}'. Fetching full response.`);
    const result = await this.callTool(caller, toolName, toolArgs, toolCallTemplate);
    yield result;
  }

  /**
   * Closes any persistent connections or resources held by the communication protocol.
   * For stateless HTTP, this clears OAuth tokens.
   */
  public async close(): Promise<void> {
    this._oauthTokens.clear();
    this._logInfo("HTTP Communication Protocol closed. OAuth tokens cleared.");
    return Promise.resolve();
  }

  /**
   * Applies authentication details from the HttpCallTemplate to the Axios request configuration.
   * This modifies `requestConfig.headers`, `requestConfig.params`, `requestConfig.auth`, and returns cookies.
   *
   * @param httpCallTemplate The CallTemplate containing authentication details.
   * @param requestConfig The Axios request configuration to modify.
   * @returns A Promise that resolves to an object containing any cookies to be set.
   */
  private async _applyAuthToRequestConfig(httpCallTemplate: HttpCallTemplate, requestConfig: AxiosRequestConfig): Promise<Record<string, string>> {
    const cookies: Record<string, string> = {};

    if (httpCallTemplate.auth) {
      if (httpCallTemplate.auth.auth_type === 'api_key') {
        const apiKeyAuth = httpCallTemplate.auth as ApiKeyAuth;
        if (!apiKeyAuth.api_key) {
          throw new Error("API key for ApiKeyAuth is empty.");
        }
        if (apiKeyAuth.location === 'header') {
          requestConfig.headers = { ...requestConfig.headers, [apiKeyAuth.var_name]: apiKeyAuth.api_key };
        } else if (apiKeyAuth.location === 'query') {
          requestConfig.params = { ...requestConfig.params, [apiKeyAuth.var_name]: apiKeyAuth.api_key };
        } else if (apiKeyAuth.location === 'cookie') {
          cookies[apiKeyAuth.var_name] = apiKeyAuth.api_key;
        }
      } else if (httpCallTemplate.auth.auth_type === 'basic') {
        const basicAuth = httpCallTemplate.auth as BasicAuth;
        requestConfig.auth = {
          username: basicAuth.username,
          password: basicAuth.password
        };
      } else if (httpCallTemplate.auth.auth_type === 'oauth2') {
        const oauth2Auth = httpCallTemplate.auth as OAuth2Auth;
        const token = await this._handleOAuth2(oauth2Auth);
        requestConfig.headers = { ...requestConfig.headers, 'Authorization': `Bearer ${token}` };
      }
    }
    return cookies;
  }

  /**
   * Handles OAuth2 client credentials flow, trying both body and auth header methods.
   * Caches tokens and automatically refreshes if expired.
   *
   * @param authDetails The OAuth2 authentication details.
   * @returns The access token.
   * @throws Error if token cannot be fetched.
   */
  private async _handleOAuth2(authDetails: OAuth2Auth): Promise<string> {
    const clientId = authDetails.client_id;

    const cachedToken = this._oauthTokens.get(clientId);
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.accessToken;
    }

    this._logInfo(`Fetching new OAuth2 token for client: '${clientId}'`);
    const tokenFetchPromises: Promise<string>[] = [];

    // Method 1: Send credentials in the request body
    tokenFetchPromises.push(
      (async () => {
        try {
          const bodyData = new URLSearchParams({
            'grant_type': 'client_credentials',
            'client_id': authDetails.client_id,
            'client_secret': authDetails.client_secret,
            'scope': authDetails.scope || ''
          });
          const response = await this._axiosInstance.post(
            authDetails.token_url,
            bodyData.toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
          );
          if (!response.data.access_token) {
            throw new Error("Access token not found in response.");
          }
          const expiresAt = Date.now() + (response.data.expires_in * 1000 || 3600 * 1000);
          this._oauthTokens.set(clientId, { accessToken: response.data.access_token, expiresAt });
          this._logInfo(`OAuth2 token fetched via body for client: '${clientId}'.`);
          return response.data.access_token;
        } catch (error: any) {
          this._logError(`OAuth2 with credentials in body failed for '${clientId}':`, error);
          throw error;
        }
      })()
    );

    // Method 2: Send credentials as Basic Auth header
    tokenFetchPromises.push(
      (async () => {
        try {
          const bodyData = new URLSearchParams({
            'grant_type': 'client_credentials',
            'scope': authDetails.scope || ''
          });
          const response = await this._axiosInstance.post(
            authDetails.token_url,
            bodyData.toString(),
            {
              auth: { username: authDetails.client_id, password: authDetails.client_secret },
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
          );
          if (!response.data.access_token) {
            throw new Error("Access token not found in response.");
          }
          const expiresAt = Date.now() + (response.data.expires_in * 1000 || 3600 * 1000);
          this._oauthTokens.set(clientId, { accessToken: response.data.access_token, expiresAt });
          this._logInfo(`OAuth2 token fetched via Basic Auth header for client: '${clientId}'.`);
          return response.data.access_token;
        } catch (error: any) {
          this._logError(`OAuth2 with Basic Auth header failed for '${clientId}':`, error);
          throw error;
        }
      })()
    );

    // Try both methods, and resolve if any succeed
    try {
      return await Promise.any(tokenFetchPromises);
    } catch (aggregateError: any) {
      const errorMessages = aggregateError.errors ? aggregateError.errors.map((e: Error) => e.message).join('; ') : String(aggregateError);
      throw new Error(`Failed to fetch OAuth2 token for client '${clientId}' after trying all methods. Details: ${errorMessages}`);
    }
  }

  /**
   * Builds a URL by substituting path parameters from the provided arguments.
   * Used arguments are removed from the `args` object.
   *
   * @param urlTemplate The URL template with path parameters in `{param_name}` format.
   * @param args The dictionary of arguments; modified to remove path parameters.
   * @returns The URL with path parameters substituted.
   * @throws Error if a required path parameter is missing.
   */
  private _buildUrlWithPathParams(urlTemplate: string, args: Record<string, any>): string {
    let url = urlTemplate;
    const pathParams = urlTemplate.match(/\{([^}]+)\}/g) || [];

    for (const param of pathParams) {
      const paramName = param.slice(1, -1);
      if (paramName in args) {
        // URL-encode the parameter value to prevent path injection
        url = url.replace(param, encodeURIComponent(String(args[paramName])));
        delete args[paramName];
      } else {
        throw new Error(`Missing required path parameter: ${paramName}`);
      }
    }

    const remainingParams = url.match(/\{([^}]+)\}/g);
    if (remainingParams && remainingParams.length > 0) {
      throw new Error(`Missing required path parameters in URL template: ${remainingParams.join(', ')}`);
    }

    return url;
  }
}