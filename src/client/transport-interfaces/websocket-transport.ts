import WebSocket from 'ws';
import { Tool } from '../../shared/tool';
import { WebSocketProvider } from '../../shared/provider';
import { ClientTransportInterface } from './client-transport-interface';

/**
 * WebSocket transport implementation for UTCP client
 */
export class WebSocketClientTransport implements ClientTransportInterface {
  private connections: Map<string, WebSocket> = new Map();

  canHandle(tool: Tool): boolean {
    return tool.provider.provider_type === 'websocket';
  }

  async callTool(tool: Tool, args: Record<string, any>): Promise<any> {
    if (!this.canHandle(tool)) {
      throw new Error(`WebSocketClientTransport cannot handle tool with provider type: ${tool.provider.provider_type}`);
    }

    const provider = tool.provider as WebSocketProvider;
    const ws = await this.getConnection(provider);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket call timeout'));
      }, 30000);

      const messageHandler = (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString());
          clearTimeout(timeout);
          ws.off('message', messageHandler);
          resolve(response);
        } catch (error) {
          clearTimeout(timeout);
          ws.off('message', messageHandler);
          reject(new Error(`Failed to parse WebSocket response: ${error}`));
        }
      };

      ws.on('message', messageHandler);

      // Send the request
      const request = {
        tool: tool.name,
        args: args,
      };

      ws.send(JSON.stringify(request));
    });
  }

  private async getConnection(provider: WebSocketProvider): Promise<WebSocket> {
    const connectionKey = `${provider.url}:${provider.name}`;
    
    if (this.connections.has(connectionKey)) {
      const existingWs = this.connections.get(connectionKey)!;
      if (existingWs.readyState === WebSocket.OPEN) {
        return existingWs;
      }
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(provider.url, provider.subprotocols, {
        headers: provider.headers,
      });

      ws.on('open', () => {
        this.connections.set(connectionKey, ws);
        resolve(ws);
      });

      ws.on('error', (error) => {
        reject(new Error(`WebSocket connection failed: ${error.message}`));
      });

      ws.on('close', () => {
        this.connections.delete(connectionKey);
      });
    });
  }

  async cleanup(): Promise<void> {
    for (const [key, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      this.connections.delete(key);
    }
  }
}
