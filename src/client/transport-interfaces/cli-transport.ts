import { spawn } from 'child_process';
import { Tool } from '../../shared/tool';
import { CliProvider } from '../../shared/provider';
import { ClientTransportInterface } from './client-transport-interface';

/**
 * CLI transport implementation for UTCP client
 */
export class CliClientTransport implements ClientTransportInterface {
  canHandle(tool: Tool): boolean {
    return tool.provider.provider_type === 'cli';
  }

  async callTool(tool: Tool, args: Record<string, any>): Promise<any> {
    if (!this.canHandle(tool)) {
      throw new Error(`CliClientTransport cannot handle tool with provider type: ${tool.provider.provider_type}`);
    }

    const provider = tool.provider as CliProvider;
    
    return new Promise((resolve, reject) => {
      const processArgs = provider.args ? [...provider.args] : [];
      
      // Add arguments from the tool call
      for (const [key, value] of Object.entries(args)) {
        processArgs.push(`--${key}`, String(value));
      }

      const childProcess = spawn(provider.command, processArgs, {
        cwd: provider.cwd,
        env: { ...process.env, ...provider.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code) => {
        if (code === 0) {
          try {
            // Try to parse as JSON, fallback to raw string
            const result = JSON.parse(stdout);
            resolve(result);
          } catch {
            resolve(stdout.trim());
          }
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      childProcess.on('error', (error) => {
        reject(new Error(`Failed to start command: ${error.message}`));
      });

      // Handle timeout
      if (provider.timeout) {
        setTimeout(() => {
          childProcess.kill();
          reject(new Error(`Command timeout after ${provider.timeout}ms`));
        }, provider.timeout);
      }
    });
  }
}
