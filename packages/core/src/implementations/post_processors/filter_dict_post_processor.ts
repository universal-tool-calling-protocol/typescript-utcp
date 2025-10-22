// packages/core/src/implementations/post_processors/filter_dict_post_processor.ts
import { z } from 'zod';
import { ToolPostProcessor } from '../../interfaces/tool_post_processor';
import { Tool } from '../../data/tool';
import { CallTemplate } from '../../data/call_template';
import { IUtcpClient } from '../../interfaces/utcp_client_interface';
import { Serializer } from '../../interfaces/serializer';

/**
 * Implements a tool post-processor that filters dictionary keys from tool results.
 * It can recursively process nested dictionaries and arrays.
 * Filtering can be configured to exclude specific keys, or only include specific keys.
 * Processing can also be conditional based on the tool's or manual's name.
 */
export class FilterDictPostProcessor implements ToolPostProcessor {
  public readonly tool_post_processor_type: 'filter_dict' = 'filter_dict';
  private readonly excludeKeys?: Set<string>;
  private readonly onlyIncludeKeys?: Set<string>;
  private readonly excludeTools?: Set<string>;
  private readonly onlyIncludeTools?: Set<string>;
  private readonly excludeManuals?: Set<string>;
  private readonly onlyIncludeManuals?: Set<string>;
  private readonly _config: FilterDictPostProcessorConfig; 

  constructor(config: FilterDictPostProcessorConfig) {
    this._config = FilterDictPostProcessorConfigSchema.parse(config);
    this.excludeKeys = config.exclude_keys ? new Set(config.exclude_keys) : undefined;
    this.onlyIncludeKeys = config.only_include_keys ? new Set(config.only_include_keys) : undefined;
    this.excludeTools = config.exclude_tools ? new Set(config.exclude_tools) : undefined;
    this.onlyIncludeTools = config.only_include_tools ? new Set(config.only_include_tools) : undefined;
    this.excludeManuals = config.exclude_manuals ? new Set(config.exclude_manuals) : undefined;
    this.onlyIncludeManuals = config.only_include_manuals ? new Set(config.only_include_manuals) : undefined;
    

    if (this.excludeKeys && this.onlyIncludeKeys) {
      console.warn("FilterDictPostProcessor configured with both 'exclude_keys' and 'only_include_keys'. 'exclude_keys' will be ignored.");
    }
    if (this.excludeTools && this.onlyIncludeTools) {
      console.warn("FilterDictPostProcessor configured with both 'exclude_tools' and 'only_include_tools'. 'exclude_tools' will be ignored.");
    }
    if (this.excludeManuals && this.onlyIncludeManuals) {
      console.warn("FilterDictPostProcessor configured with both 'exclude_manuals' and 'only_include_manuals'. 'exclude_manuals' will be ignored.");
    }
  }

    /**
   * Converts the post-processor instance's configuration to a dictionary.
   */
    public toDict(): FilterDictPostProcessorConfig {
      return this._config;
  }

  /**
   * Processes the result of a tool call, applying filtering logic.
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

    if (this.onlyIncludeKeys) {
      return this._filterDictOnlyIncludeKeys(result);
    }
    if (this.excludeKeys) {
      return this._filterDictExcludeKeys(result);
    }
    return result;
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
   * Recursively filters a dictionary, keeping only specified keys.
   * @param data The data to filter.
   * @returns The filtered data.
   */
  private _filterDictOnlyIncludeKeys(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this._filterDictOnlyIncludeKeys(item)).filter(item => {
        if (typeof item === 'object' && item !== null) {
          if (Array.isArray(item)) return item.length > 0;
          return Object.keys(item).length > 0;
        }
        return true;
      });
    }

    const newObject: { [key: string]: any } = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (this.onlyIncludeKeys?.has(key)) {
          newObject[key] = this._filterDictOnlyIncludeKeys(data[key]);
        } else {
          const processedValue = this._filterDictOnlyIncludeKeys(data[key]);
          if (typeof processedValue === 'object' && processedValue !== null) {
            if (Array.isArray(processedValue) && processedValue.length > 0) {
              newObject[key] = processedValue;
            } else if (Object.keys(processedValue).length > 0) {
              newObject[key] = processedValue;
            }
          }
        }
      }
    }
    return newObject;
  }

  /**
   * Recursively filters a dictionary, excluding specified keys.
   * @param data The data to filter.
   * @returns The filtered data.
   */
  private _filterDictExcludeKeys(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this._filterDictExcludeKeys(item)).filter(item => {
        if (typeof item === 'object' && item !== null) {
          if (Array.isArray(item)) return item.length > 0;
          return Object.keys(item).length > 0;
        }
        return true;
      });
    }

    const newObject: { [key: string]: any } = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (!this.excludeKeys?.has(key)) {
          newObject[key] = this._filterDictExcludeKeys(data[key]);
        }
      }
    }
    return newObject;
  }
}

/**
 * Schema for the FilterDictPostProcessor configuration.
 */
const FilterDictPostProcessorConfigSchema = z.object({
  tool_post_processor_type: z.literal('filter_dict'),
  exclude_keys: z.array(z.string()).optional(),
  only_include_keys: z.array(z.string()).optional(),
  exclude_tools: z.array(z.string()).optional(),
  only_include_tools: z.array(z.string()).optional(),
  exclude_manuals: z.array(z.string()).optional(),
  only_include_manuals: z.array(z.string()).optional(),
}).passthrough();

type FilterDictPostProcessorConfig = z.infer<typeof FilterDictPostProcessorConfigSchema>;

export class FilterDictPostProcessorSerializer extends Serializer<FilterDictPostProcessor> {
  toDict(obj: FilterDictPostProcessor): { [key: string]: any } {
    const filterDictConfig = obj.toDict()
    return {
      tool_post_processor_type: filterDictConfig.tool_post_processor_type,
      exclude_keys: filterDictConfig.exclude_keys,
      only_include_keys: filterDictConfig.only_include_keys,
      exclude_tools: filterDictConfig.exclude_tools,
      only_include_tools: filterDictConfig.only_include_tools,
      exclude_manuals: filterDictConfig.exclude_manuals,
      only_include_manuals: filterDictConfig.only_include_manuals,
    };
  }

  validateDict(data: { [key: string]: any }): FilterDictPostProcessor {
    try {
      return new FilterDictPostProcessor(FilterDictPostProcessorConfigSchema.parse(data));
    } catch (e) {
      if (e instanceof z.ZodError) {
        throw new Error(`Invalid configuration: ${e.message}`);
      }
      throw new Error("Unexpected error during validation");
    }
  }
}