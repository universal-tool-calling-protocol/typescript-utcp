import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { Tool } from '../../shared/tool';
import { HttpProvider } from '../../shared/provider';
import { AuthUnion } from '../../shared/auth';
import { ClientTransportInterface } from './client-transport-interface';

/**
 * HTTP transport implementation for UTCP client
 */
export class HttpClientTransport implements ClientTransportInterface {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  canHandle(tool: Tool): boolean {
    return tool.provider.provider_type === 'http';
  }

  async callTool(tool: Tool, args: Record<string, any>): Promise<any> {
    if (!this.canHandle(tool)) {
      throw new Error(`HttpClientTransport cannot handle tool with provider type: ${tool.provider.provider_type}`);
    }

    const provider = tool.provider as HttpProvider;
    const config: AxiosRequestConfig = {
      method: provider.http_method,
      url: provider.url,
      headers: {
        ...provider.headers,
        'Content-Type': provider.content_type,
      },
    };

    // Handle authentication
    if (provider.auth) {
      this.addAuthToRequest(config, provider.auth);
    }

    // Handle header fields
    if (provider.header_fields) {
      for (const field of provider.header_fields) {
        if (args[field] !== undefined) {
          config.headers![field] = args[field];
          delete args[field];
        }
      }
    }

    // Handle body
    if (provider.http_method !== 'GET' && provider.http_method !== 'DELETE') {
      if (provider.body_field && args[provider.body_field]) {
        config.data = args[provider.body_field];
      } else {
        config.data = args;
      }
    } else if (Object.keys(args).length > 0) {
      config.params = args;
    }

    try {
      const response = await this.axiosInstance(config);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`HTTP request failed: ${error.message}${error.response ? ` (${error.response.status})` : ''}`);
      }
      throw error;
    }
  }

  private addAuthToRequest(config: AxiosRequestConfig, auth: AuthUnion): void {
    switch (auth.auth_type) {
      case 'api_key':
        config.headers![auth.header_name] = `${auth.header_value_prefix}${auth.api_key}`;
        break;
      case 'basic':
        const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        config.headers!['Authorization'] = `Basic ${credentials}`;
        break;
      case 'oauth2':
        // OAuth2 would require token exchange, simplified for now
        throw new Error('OAuth2 authentication not yet implemented');
      default:
        throw new Error(`Unknown auth type: ${(auth as any).auth_type}`);
    }
  }
}
