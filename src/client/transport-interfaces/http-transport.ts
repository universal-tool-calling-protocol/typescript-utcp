import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { ClientTransportInterface } from '../client-transport-interface';
import { Tool } from '../../shared/tool';
import { ProviderUnion, HttpProvider } from '../../shared/provider';
import { UtcpManual } from '../../shared/utcp-manual';
import { OpenApiConverter } from '../openapi-converter';
import { ApiKeyAuth, BasicAuth, OAuth2Auth } from '../../shared/auth';

/**
 * HTTP transport implementation for UTCP clients
 */
export class HttpClientTransport implements ClientTransportInterface {
  private _oauthTokens: Record<string, Record<string, any>> = {};
  private _logger: (message: string, error?: boolean) => void;

  /**
   * Create a new HTTP transport
   * @param logger Optional logger function
   */
  constructor(logger?: (message: string, error?: boolean) => void) {
    this._logger =
      logger ||
      ((message: string, isError?: boolean) => {
        if (isError) {
          console.error(`[UTCP-HttpTransport] ${message}`);
        } else {
          console.log(`[UTCP-HttpTransport] ${message}`);
        }
      });
  }

  /**
   * Discover tools from a REST API provider
   * @param provider Details of the REST provider
   * @returns List of tool declarations, or empty array if discovery fails
   */
  async register_tool_provider(provider: ProviderUnion): Promise<Tool[]> {
    if (provider.provider_type !== 'http') {
      throw new Error("HttpTransport can only be used with HttpProvider");
    }

    try {
      const url = provider.url;
      
      // Security check: Enforce HTTPS or localhost to prevent MITM attacks
      if (!url.startsWith('https://') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
        throw new Error(
          `Security error: URL must use HTTPS or start with 'http://localhost' or 'http://127.0.0.1'. Got: ${url}. ` +
          "Non-secure URLs are vulnerable to man-in-the-middle attacks."
        );
      }
      
      this._logger(`Discovering tools from '${provider.name}' (REST) at ${url}`);
      
      try {
        const response = await axios.get(url, { 
          timeout: 10000 // 10 second timeout
        });
        
        const responseData = response.data;
        this._logger(`Received data from ${url}: ${JSON.stringify(responseData, null, 2)}`);

        // Check if the response is a UTCP manual or an OpenAPI spec
        if (responseData && responseData.version && Array.isArray(responseData.tools)) {
          this._logger(`Detected UTCP manual from '${provider.name}'. Processing tools...`);
          const utcpManual = responseData as UtcpManual;
          this._logger(`Found ${utcpManual.tools.length} tools in manual.`);
          // The tools in the manual should already have their own provider info.
          return utcpManual.tools;
        } else {
          this._logger(`Data from '${provider.name}' is not a valid UTCP manual. Assuming OpenAPI spec...`);
          const converter = new OpenApiConverter(responseData);
          const utcpManual = converter.convert();
          this._logger(`Found ${utcpManual.tools.length} tools after OpenAPI conversion.`);
          return utcpManual.tools;
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          this._logger(`Error connecting to REST provider '${provider.name}': ${error.message}`, true);
        } else {
          this._logger(`Error parsing JSON from REST provider '${provider.name}': ${String(error)}`, true);
        }
        return [];
      }
    } catch (error) {
      this._logger(`Unexpected error discovering tools from REST provider '${provider.name}': ${String(error)}`, true);
      return [];
    }
  }

  /**
   * Deregistering a tool provider is a no-op for the stateless HTTP transport
   * @param provider The provider to deregister
   */
  async deregister_tool_provider(provider: ProviderUnion): Promise<void> {
    // No-op for stateless HTTP transport
  }

  /**
   * Calls a tool on an HTTP provider
   * @param tool_name The name of the tool to call
   * @param args Arguments to pass to the tool
   * @param provider The provider to use
   * @returns The result of the tool call
   */
  async call_tool(tool_name: string, args: Record<string, any>, provider: ProviderUnion): Promise<any> {
    if (provider.provider_type !== 'http') {
      throw new Error("HttpClientTransport can only be used with HttpProvider");
    }

    const httpProvider = provider as HttpProvider;
    const requestHeaders: Record<string, string> = { ...httpProvider.headers };
    let bodyContent: any = null;

    const remainingArgs = { ...args };

    // Handle header fields
    if (httpProvider.header_fields) {
      for (const fieldName of httpProvider.header_fields) {
        if (fieldName in remainingArgs) {
          requestHeaders[fieldName] = String(remainingArgs[fieldName]);
          delete remainingArgs[fieldName];
        }
      }
    }

    // Handle body field
    if (httpProvider.body_field && httpProvider.body_field in remainingArgs) {
      bodyContent = remainingArgs[httpProvider.body_field];
      delete remainingArgs[httpProvider.body_field];
    }

    // The rest of the arguments are query parameters
    const queryParams = remainingArgs;

    // Handle authentication
    let axiosAuthConfig: AxiosRequestConfig = {};
    if (httpProvider.auth) {
      if (httpProvider.auth.auth_type === 'api_key') {
        if (httpProvider.auth.api_key) {
          requestHeaders[httpProvider.auth.var_name] = httpProvider.auth.api_key;
        } else {
          this._logger("API key not found for ApiKeyAuth.", true);
          throw new Error("API key for ApiKeyAuth not found.");
        }
      } else if (httpProvider.auth.auth_type === 'basic') {
        const basicAuth = httpProvider.auth as BasicAuth;
        axiosAuthConfig.auth = {
          username: basicAuth.username,
          password: basicAuth.password
        };
      } else if (httpProvider.auth.auth_type === 'oauth2') {
        const token = await this._handleOAuth2(httpProvider.auth as OAuth2Auth);
        requestHeaders["Authorization"] = `Bearer ${token}`;
      }
    }

    try {
      // Set content-type header if body is provided and header not already set
      if (bodyContent !== null && !('Content-Type' in requestHeaders)) {
        requestHeaders["Content-Type"] = httpProvider.content_type;
      }

      // Prepare request config based on content type
      const requestConfig: AxiosRequestConfig = {
        ...axiosAuthConfig,
        headers: requestHeaders,
        params: queryParams,
        timeout: 30000 // 30 second timeout
      };

      // Make the request with the appropriate HTTP method
      const method = httpProvider.http_method.toLowerCase();
      let response: AxiosResponse;

      if (['post', 'put', 'patch'].includes(method)) {
        // For methods that support body content
        const requestFn = axios[method as 'post' | 'put' | 'patch'];
        response = await requestFn(httpProvider.url, bodyContent, requestConfig);
      } else {
        // For methods without body content (GET, DELETE)
        const requestFn = axios[method as 'get' | 'delete'];
        response = await requestFn(httpProvider.url, requestConfig);
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this._logger(`Error calling tool '${tool_name}' on provider '${provider.name}': ${error.message}`, true);
      } else {
        this._logger(`Unexpected error calling tool '${tool_name}': ${String(error)}`, true);
      }
      throw error;
    }
  }

  /**
   * Handles OAuth2 client credentials flow, trying both body and auth header methods
   * @param authDetails The OAuth2 authentication details
   * @returns The access token
   */
  private async _handleOAuth2(authDetails: OAuth2Auth): Promise<string> {
    const clientId = authDetails.client_id;

    // Return cached token if available
    if (this._oauthTokens[clientId]) {
      return this._oauthTokens[clientId].access_token;
    }

    // Method 1: Send credentials in the request body
    try {
      this._logger("Attempting OAuth2 token fetch with credentials in body.");
      const bodyData = new URLSearchParams({
        'grant_type': 'client_credentials',
        'client_id': authDetails.client_id,
        'client_secret': authDetails.client_secret,
        'scope': authDetails.scope || ''
      });

      const response = await axios.post(
        authDetails.token_url,
        bodyData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      this._oauthTokens[clientId] = response.data;
      return response.data.access_token;
    } catch (error) {
      this._logger(`OAuth2 with credentials in body failed: ${String(error)}. Trying Basic Auth header.`);
    }

    // Method 2: Send credentials as Basic Auth header
    try {
      this._logger("Attempting OAuth2 token fetch with Basic Auth header.");
      const bodyData = new URLSearchParams({
        'grant_type': 'client_credentials',
        'scope': authDetails.scope || ''
      });

      const response = await axios.post(
        authDetails.token_url,
        bodyData.toString(),
        {
          auth: {
            username: authDetails.client_id,
            password: authDetails.client_secret
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      this._oauthTokens[clientId] = response.data;
      return response.data.access_token;
    } catch (error) {
      this._logger(`OAuth2 with Basic Auth header also failed: ${String(error)}`, true);
      throw error;
    }
  }
}
