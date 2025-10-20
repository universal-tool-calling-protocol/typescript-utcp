// packages/core/src/implementations/post_processors/limit_strings_post_processor.ts
import { z } from 'zod';
import { ToolPostProcessor } from '../../interfaces/tool_post_processor';
import { Tool } from '../../data/tool';
import { CallTemplate } from '../../data/call_template';
import { IUtcpClient } from '../../interfaces/utcp_client_interface';
import { Serializer } from '../../interfaces/serializer';

/**
 * Implements a tool post-processor that truncates string values within a tool's result.
 * It recursively processes nested objects and arrays, limiting the length of any string encountered.
 * Processing can be conditional based on the tool's or manual's name.
 */
export class LimitStringsPostProcessor implements ToolPostProcessor {
  public readonly tool_post_processor_type: 'limit_strings' = 'limit_strings';
  private readonly limit: number;
  private readonly excludeTools?: Set<string>;
  private readonly onlyIncludeTools?: Set<string>;
  private readonly excludeManuals?: Set<string>;
  private readonly onlyIncludeManuals?: Set<string>;
  private readonly _config: LimitStringsPostProcessorConfig; 

  constructor(config: LimitStringsPostProcessorConfig) {
    this._config = LimitStringsPostProcessorConfigSchema.parse(config);
    this.limit = config.limit;
    this.excludeTools = config.exclude_tools ? new Set(config.exclude_tools) : undefined;
    this.onlyIncludeTools = config.only_include_tools ? new Set(config.only_include_tools) : undefined;
    this.excludeManuals = config.exclude_manuals ? new Set(config.exclude_manuals) : undefined;
    this.onlyIncludeManuals = config.only_include_manuals ? new Set(config.only_include_manuals) : undefined;

    if (this.excludeTools && this.onlyIncludeTools) {
      console.warn("LimitStringsPostProcessor configured with both 'exclude_tools' and 'only_include_tools'. 'exclude_tools' will be ignored.");
    }
    if (this.excludeManuals && this.onlyIncludeManuals) {
      console.warn("LimitStringsPostProcessor configured with both 'exclude_manuals' and 'only_include_manuals'. 'exclude_manuals' will be ignored.");
    }
  }

    /**
   * Converts the post-processor instance's configuration to a dictionary.
   */
    public toDict(): LimitStringsPostProcessorConfig {
      return this._config;
  }

  /**
   * Processes the result of a tool call, truncating string values if applicable.
   * @param caller The UTCP client instance.
   * @param tool The Tool object that was called.
   * @param manualCallTemplate The CallTemplateBase object of the manual that owns the tool.
   * @param result The raw result returned by the tool's communication protocol.
   * @returns The processed result.
   */
  public postProcess(caller: IUtcpClient, tool: Tool, manualCallTemplate: CallTemplate, result: any): any {
    if (this.shouldSkipProcessing(tool, manualCallTemplate)) {
      return result;
    }
    return this._processObject(result);
  }

  /**
   * Determines if processing should be skipped based on tool and manual filters.
   * @param tool The Tool object.
   * @param manualCallTemplate The CallTemplateBase object of the manual.
   * @returns True if processing should be skipped, false otherwise.
   */
  private shouldSkipProcessing(tool: Tool, manualCallTemplate: CallTemplate): boolean {
    if (this.onlyIncludeTools && !this.onlyIncludeTools.has(tool.name)) {
      return true;
    }
    if (this.excludeTools && this.excludeTools.has(tool.name)) {
      return true;
    }
    const manualName = manualCallTemplate.name;
    if (manualName) {
        if (this.onlyIncludeManuals && !this.onlyIncludeManuals.has(manualName)) {
            return true;
        }
        if (this.excludeManuals && this.excludeManuals.has(manualName)) {
            return true;
        }
    }
    return false;
  }

  /**
   * Recursively processes an object, truncating strings.
   * @param obj The object to process.
   * @returns The processed object.
   */
  private _processObject(obj: any): any {
    if (typeof obj === 'string') {
      return obj.length > this.limit ? obj.substring(0, this.limit) : obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this._processObject(item));
    }
    if (typeof obj === 'object' && obj !== null) {
      const newObj: { [key: string]: any } = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          newObj[key] = this._processObject(obj[key]);
        }
      }
      return newObj;
    }
    return obj;
  }
}

/**
 * Schema for the LimitStringsPostProcessor configuration.
 */
const LimitStringsPostProcessorConfigSchema = z.object({
  tool_post_processor_type: z.literal('limit_strings'),
  limit: z.number().int().positive().default(10000), 
  exclude_tools: z.array(z.string()).optional(),
  only_include_tools: z.array(z.string()).optional(),
  exclude_manuals: z.array(z.string()).optional(),
  only_include_manuals: z.array(z.string()).optional(),
}).passthrough();

type LimitStringsPostProcessorConfig = z.infer<typeof LimitStringsPostProcessorConfigSchema>;

export class LimitStringsPostProcessorSerializer extends Serializer<LimitStringsPostProcessor> {
  toDict(obj: LimitStringsPostProcessor): { [key: string]: any } {
    return obj.toDict();
  }

  validateDict(data: { [key: string]: any }): LimitStringsPostProcessor {
    try {
      return new LimitStringsPostProcessor(LimitStringsPostProcessorConfigSchema.parse(data));
    } catch (e) {
      if (e instanceof z.ZodError) {
        throw new Error(`Invalid configuration: ${e.message}`);
      }
      throw new Error("Unexpected error during validation");
    }
  }
}
