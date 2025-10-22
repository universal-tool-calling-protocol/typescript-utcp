// packages/core/src/implementations/in_mem_concurrent_tool_repository.ts
import { CallTemplate } from '../data/call_template';
import { Tool } from '../data/tool';
import { UtcpManual } from '../data/utcp_manual';
import { ConcurrentToolRepository } from '../interfaces/concurrent_tool_repository';
import { Serializer } from '../interfaces/serializer';
import { z } from 'zod';

/**
 * An in-memory implementation of the ConcurrentToolRepository.
 * Stores tools, manuals, and manual call templates in local maps.
 * Uses an `AsyncMutex` to serialize write operations, ensuring data consistency
 * across concurrent asynchronous calls, and returns deep copies to prevent
 * external modification of internal state.
 */
export class InMemConcurrentToolRepository implements ConcurrentToolRepository {
  public readonly tool_repository_type: string = "in_memory";
  private _config: InMemConcurrentToolRepositoryConfig; // Store the config to return in toDict

  private _toolsByName: Map<string, Tool> = new Map();
  private _manuals: Map<string, UtcpManual> = new Map();
  private _manualCallTemplates: Map<string, CallTemplate> = new Map();
  private _writeMutex: AsyncMutex = new AsyncMutex();

  /**
   * The constructor must accept the config type to match the factory signature, 
   * even if the implementation does not use it.
   */
  constructor(config: InMemConcurrentToolRepositoryConfig = { tool_repository_type: 'in_memory' }) {
    this._config = config;
    // Intentionally left empty as all state is initialized via field initializers.
  }

  /**
   * Converts the repository instance's configuration to a dictionary.
   */
    public toDict(): InMemConcurrentToolRepositoryConfig {
      return this._config;
  }

  /**
   * Saves a manual's call template and its associated tools in the repository.
   * This operation replaces any existing manual with the same name.
   * @param manualCallTemplate The call template associated with the manual to save.
   * @param manual The complete UTCP Manual object to save.
   */
  public async saveManual(manualCallTemplate: CallTemplate, manual: UtcpManual): Promise<void> {
    const release = await this._writeMutex.acquire();
    try {
      const manualName = manualCallTemplate.name!;
      const oldManual = this._manuals.get(manualName);
      if (oldManual) {
        for (const tool of oldManual.tools) {
          this._toolsByName.delete(tool.name);
        }
      }
      this._manualCallTemplates.set(manualName, { ...manualCallTemplate });
      this._manuals.set(manualName, { ...manual, tools: manual.tools.map(t => ({ ...t })) });
      for (const tool of manual.tools) {
        this._toolsByName.set(tool.name, { ...tool });
      }
    } finally {
      release();
    }
  }

  /**
   * Removes a manual and its tools from the repository.
   * @param manualName The name of the manual to remove.
   * @returns True if the manual was removed, False otherwise.
   */
  public async removeManual(manualName: string): Promise<boolean> {
    const release = await this._writeMutex.acquire();
    try {
      const oldManual = this._manuals.get(manualName);
      if (!oldManual) {
        return false;
      }

      for (const tool of oldManual.tools) {
        this._toolsByName.delete(tool.name);
      }

      this._manuals.delete(manualName);
      this._manualCallTemplates.delete(manualName);
      return true;
    } finally {
      release();
    }
  }

  /**
   * Removes a specific tool from the repository.
   * Note: This also attempts to remove the tool from any associated manual.
   * @param toolName The full namespaced name of the tool to remove.
   * @returns True if the tool was removed, False otherwise.
   */
  public async removeTool(toolName: string): Promise<boolean> {
    const release = await this._writeMutex.acquire();
    try {
      const toolRemoved = this._toolsByName.delete(toolName);
      if (!toolRemoved) {
        return false;
      }

      const manualName = toolName.split('.')[0];
      if (manualName) {
        const manual = this._manuals.get(manualName);
        if (manual) {
          manual.tools = manual.tools.filter(t => t.name !== toolName);
        }
      }
      return true;
    } finally {
      release();
    }
  }

  /**
   * Retrieves a tool by its full namespaced name.
   * @param toolName The full namespaced name of the tool to retrieve.
   * @returns The tool if found, otherwise undefined.
   */
  public async getTool(toolName: string): Promise<Tool | undefined> {
    const tool = this._toolsByName.get(toolName);
    return tool ? { ...tool } : undefined;
  }

  /**
   * Retrieves all tools from the repository.
   * @returns A list of all registered tools.
   */
  public async getTools(): Promise<Tool[]> {
    return Array.from(this._toolsByName.values()).map(t => ({ ...t }));
  }

  /**
   * Retrieves all tools associated with a specific manual.
   * @param manualName The name of the manual.
   * @returns A list of tools associated with the manual, or undefined if the manual is not found.
   */
  public async getToolsByManual(manualName: string): Promise<Tool[] | undefined> {
    const manual = this._manuals.get(manualName);
    return manual ? manual.tools.map(t => ({ ...t })) : undefined;
  }

  /**
   * Retrieves a complete UTCP Manual object by its name.
   * @param manualName The name of the manual to retrieve.
   * @returns The manual if found, otherwise undefined.
   */
  public async getManual(manualName: string): Promise<UtcpManual | undefined> {
    const manual = this._manuals.get(manualName);
    return manual ? { ...manual, tools: manual.tools.map(t => ({ ...t })) } : undefined;
  }

  /**
   * Retrieves all registered manuals from the repository.
   * @returns A list of all registered UtcpManual objects.
   */
  public async getManuals(): Promise<UtcpManual[]> {
    return Array.from(this._manuals.values()).map(m => ({ ...m, tools: m.tools.map(t => ({ ...t })) }));
  }

  /**
   * Retrieves a manual's CallTemplate by its name.
   * @param manualCallTemplateName The name of the manual's CallTemplate to retrieve.
   * @returns The CallTemplate if found, otherwise undefined.
   */
  public async getManualCallTemplate(manualCallTemplateName: string): Promise<CallTemplate | undefined> {
    const template = this._manualCallTemplates.get(manualCallTemplateName);
    return template ? { ...template } : undefined;
  }

  /**
   * Retrieves all registered manual CallTemplates from the repository.
   * @returns A list of all registered CallTemplateBase objects.
   */
  public async getManualCallTemplates(): Promise<CallTemplate[]> {
    return Array.from(this._manualCallTemplates.values()).map(t => ({ ...t }));
  }
}

export class InMemConcurrentToolRepositorySerializer extends Serializer<InMemConcurrentToolRepository> {
  toDict(obj: InMemConcurrentToolRepository): { [key: string]: any } {
    return {
      tool_repository_type: obj.tool_repository_type
    }
  }

  validateDict(data: { [key: string]: any }): InMemConcurrentToolRepository {
    try {
      return new InMemConcurrentToolRepository(InMemConcurrentToolRepositoryConfigSchema.parse(data));
    } catch (e) {
      if (e instanceof z.ZodError) {
        throw new Error(`Invalid configuration: ${e.message}`);
      }
      throw new Error("Unexpected error during validation");
    }
  }
}

/**
 * A simple asynchronous mutex to serialize write access to shared resources.
 * In a single-threaded JavaScript environment, this primarily ensures that
 * compound asynchronous operations on shared state do not interleave incorrectly.
 */
class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked: boolean = false;

  /**
   * Acquires the mutex. If the mutex is already locked, waits until it's released.
   * @returns A function to call to release the mutex.
   */
  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this._release.bind(this);
    } else {
      return new Promise<() => void>(resolve => {
        this.queue.push(() => {
          this.locked = true;
          resolve(this._release.bind(this));
        });
      });
    }
  }

  /**
   * Releases the mutex, allowing the next queued operation (if any) to proceed.
   */
  private _release(): void {
    this.locked = false;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

/**
 * Schema for the InMemConcurrentToolRepository configuration.
 */
const InMemConcurrentToolRepositoryConfigSchema = z.object({
  tool_repository_type: z.literal('in_memory'),
}).passthrough();

type InMemConcurrentToolRepositoryConfig = z.infer<typeof InMemConcurrentToolRepositoryConfigSchema>;
