import { UtcpClient, Tool, JsonSchema, UtcpClientConfig } from '@utcp/sdk';
import { createContext, runInContext } from 'vm';

/**
 * CodeModeUtcpClient extends UtcpClient to provide TypeScript code execution capabilities.
 * This allows executing TypeScript code that can directly call registered tools as functions.
 */
export class CodeModeUtcpClient extends UtcpClient {
  private toolFunctionCache: Map<string, string> = new Map();

  /**
   * Standard prompt template for AI agents using CodeModeUtcpClient.
   * This provides guidance on how to properly discover and use tools within code execution.
   */
  public static readonly AGENT_PROMPT_TEMPLATE = `
## UTCP CodeMode Tool Usage Guide

You have access to a CodeModeUtcpClient that allows you to execute TypeScript code with access to registered tools. Follow this workflow:

### 1. Tool Discovery Phase
**Always start by discovering available tools:**
- Tools are organized by manual namespace (e.g., \`manual_name.tool_name\`)
- Use hierarchical access patterns: \`await manual.tool({ param: value })\`
- Multiple manuals can contain tools with the same name - namespaces prevent conflicts

### 2. Interface Introspection
**Understand tool contracts before using them:**
- Access \`__interfaces\` to see all available TypeScript interface definitions
- Use \`__getToolInterface('manual.tool')\` to get specific tool interfaces
- Interfaces show required inputs, expected outputs, and descriptions
- Look for "Access as: manual.tool(args)" comments for usage patterns

### 3. Code Execution Guidelines
**When writing code for \`callToolChain\`:**
- Use \`await manual.tool({ param: value })\` syntax for all tool calls
- Tools are async functions that return promises
- You have access to standard JavaScript globals: \`console\`, \`JSON\`, \`Math\`, \`Date\`, etc.
- All console output (\`console.log\`, \`console.error\`, etc.) is automatically captured and returned
- Build properly structured input objects based on interface definitions
- Handle errors appropriately with try/catch blocks
- Chain tool calls by using results from previous calls

### 4. Best Practices
- **Discover first, code second**: Always explore available tools before writing execution code
- **Respect namespaces**: Use full \`manual.tool\` names to avoid conflicts
- **Parse interfaces**: Use interface information to construct proper input objects
- **Error handling**: Wrap tool calls in try/catch for robustness
- **Data flow**: Chain tools by passing outputs as inputs to subsequent tools

### 5. Available Runtime Context
- \`__interfaces\`: String containing all TypeScript interface definitions
- \`__getToolInterface(toolName)\`: Function to get specific tool interface
- All registered tools as \`manual.tool\` functions
- Standard JavaScript built-ins for data processing

Remember: Always discover and understand available tools before attempting to use them in code execution.
`.trim();

  /**
   * Creates a new CodeModeUtcpClient instance.
   * This creates a regular UtcpClient and then upgrades it to a CodeModeUtcpClient
   * with all the same configuration and additional code execution capabilities.
   * 
   * @param root_dir The root directory for the client to resolve relative paths from
   * @param config The configuration for the client
   * @returns A new CodeModeUtcpClient instance
   */
  public static async create(
    root_dir: string = process.cwd(),
    config: UtcpClientConfig | null = null
  ): Promise<CodeModeUtcpClient> {
    // Create a regular UtcpClient first
    const baseClient = await UtcpClient.create(root_dir, config);
    
    // Create a CodeModeUtcpClient using the same configuration
    const codeModeClient = Object.setPrototypeOf(baseClient, CodeModeUtcpClient.prototype) as CodeModeUtcpClient;
    
    // Initialize the cache
    (codeModeClient as any).toolFunctionCache = new Map();
    
    return codeModeClient;
  }

  /**
   * Converts a Tool object into a TypeScript function interface string.
   * This generates the function signature that can be used in TypeScript code.
   * 
   * @param tool The Tool object to convert
   * @returns TypeScript function interface as a string
   */
  public toolToTypeScriptInterface(tool: Tool): string {
    if (this.toolFunctionCache.has(tool.name)) {
      return this.toolFunctionCache.get(tool.name)!;
    }

    // Generate hierarchical interface structure
    let interfaceContent: string;
    let accessPattern: string;
    
    if (tool.name.includes('.')) {
      const [manualName, ...toolParts] = tool.name.split('.');
      const toolName = toolParts.join('_');
      accessPattern = `${manualName}.${toolName}`;
      
      // Generate interfaces within namespace
      const inputInterfaceContent = this.jsonSchemaToObjectContent(tool.inputs);
      const outputInterfaceContent = this.jsonSchemaToObjectContent(tool.outputs);
      
      interfaceContent = `
namespace ${manualName} {
  interface ${toolName}Input {
${inputInterfaceContent}
  }

  interface ${toolName}Output {
${outputInterfaceContent}
  }
}`;
    } else {
      // No manual namespace, generate flat interfaces
      accessPattern = tool.name;
      const inputType = this.jsonSchemaToTypeScript(tool.inputs, `${tool.name}Input`);
      const outputType = this.jsonSchemaToTypeScript(tool.outputs, `${tool.name}Output`);
      interfaceContent = `${inputType}\n\n${outputType}`;
    }
    const interfaceString = `
${interfaceContent}

/**
 * ${tool.description}
 * Tags: ${tool.tags.join(', ')}
 * Access as: ${accessPattern}(args)
 */`;

    this.toolFunctionCache.set(tool.name, interfaceString);
    return interfaceString;
  }

  /**
   * Converts all registered tools to TypeScript interface definitions.
   * This provides the complete type definitions for all available tools.
   * 
   * @returns A complete TypeScript interface definition string
   */
  public async getAllToolsTypeScriptInterfaces(): Promise<string> {
    const tools = await this.getTools();
    const interfaces = tools.map(tool => this.toolToTypeScriptInterface(tool));
    
    return `// Auto-generated TypeScript interfaces for UTCP tools
${interfaces.join('\n\n')}`;
  }

  /**
   * Executes TypeScript code with access to registered tools and captures console output.
   * The code can call tools directly as functions and has access to standard JavaScript globals.
   * 
   * @param code TypeScript code to execute  
   * @param timeout Optional timeout in milliseconds (default: 30000)
   * @returns Object containing both the execution result and captured console logs
   */
  public async callToolChain(code: string, timeout: number = 30000): Promise<{result: any, logs: string[]}> {
    const tools = await this.getTools();
    
    // Create the execution context with tool functions and log capture
    const logs: string[] = [];
    const context = await this.createExecutionContext(tools, logs);
    
    try {
      // Create VM context
      const vmContext = createContext(context);
      
      // Wrap the user code in an async function and execute it
      const wrappedCode = `
        (async () => {
          ${code}
        })()
      `;
      
      // Execute with timeout
      const result = await this.runWithTimeout(wrappedCode, vmContext, timeout);
      return { result, logs };
    } catch (error) {
      throw new Error(`Code execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Runs code in VM context with timeout support.
   * 
   * @param code Code to execute
   * @param context VM context
   * @param timeout Timeout in milliseconds
   * @returns Execution result
   */
  private async runWithTimeout(code: string, context: any, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Code execution timed out after ${timeout}ms`));
      }, timeout);

      try {
        const result = runInContext(code, context);
        
        // Handle both sync and async results
        Promise.resolve(result)
          .then(finalResult => {
            clearTimeout(timeoutId);
            resolve(finalResult);
          })
          .catch(error => {
            clearTimeout(timeoutId);
            reject(error);
          });
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Creates the execution context for running TypeScript code.
   * This context includes tool functions and basic JavaScript globals.
   * 
   * @param tools Array of tools to make available
   * @param logs Optional array to capture console.log output
   * @returns Execution context object
   */
  private async createExecutionContext(tools: Tool[], logs?: string[]): Promise<Record<string, any>> {
    // Create console object (either capturing logs or using standard console)
    const consoleObj = logs ? {
      log: (...args: any[]) => {
        logs.push(args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '));
      },
      error: (...args: any[]) => {
        logs.push('[ERROR] ' + args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '));
      },
      warn: (...args: any[]) => {
        logs.push('[WARN] ' + args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '));
      },
      info: (...args: any[]) => {
        logs.push('[INFO] ' + args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '));
      }
    } : console;

    const context: Record<string, any> = {
      // Add basic utilities
      console: consoleObj,
      JSON,
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Math,
      Date,
      
      // Add TypeScript interface definitions for reference
      __interfaces: await this.getAllToolsTypeScriptInterfaces(),
      __getToolInterface: (toolName: string) => {
        const tool = tools.find(t => t.name === toolName);
        return tool ? this.toolToTypeScriptInterface(tool) : null;
      }
    };

    // Add tool functions to context organized by manual name
    for (const tool of tools) {
      if (tool.name.includes('.')) {
        const [manualName, ...toolParts] = tool.name.split('.');
        const toolName = toolParts.join('_'); // Join remaining parts with underscore
        
        // Create manual namespace object if it doesn't exist
        if (!context[manualName]) {
          context[manualName] = {};
        }
        
        // Add the tool function to the manual namespace
        context[manualName][toolName] = async (args: Record<string, any>) => {
          try {
            return await this.callTool(tool.name, args);
          } catch (error) {
            throw new Error(`Error calling tool '${tool.name}': ${error instanceof Error ? error.message : String(error)}`);
          }
        };
      } else {
        // If no dot, add directly to root context (no manual name)
        context[tool.name] = async (args: Record<string, any>) => {
          try {
            return await this.callTool(tool.name, args);
          } catch (error) {
            throw new Error(`Error calling tool '${tool.name}': ${error instanceof Error ? error.message : String(error)}`);
          }
        };
      }
    }

    return context;
  }

  /**
   * Converts a JSON Schema to TypeScript object content (properties only, no interface wrapper).
   * This generates the content inside an interface definition.
   * 
   * @param schema JSON Schema to convert
   * @returns TypeScript interface properties as string
   */
  private jsonSchemaToObjectContent(schema: JsonSchema): string {
    if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
      return '    [key: string]: any;';
    }

    const properties = schema.properties || {};
    const required = schema.required || [];
    const lines: string[] = [];

    for (const [propName, propSchema] of Object.entries(properties)) {
      const isRequired = required.includes(propName);
      const optionalMarker = isRequired ? '' : '?';
      const description = (propSchema as any).description || '';
      const tsType = this.jsonSchemaToTypeScriptType(propSchema as JsonSchema);

      if (description) {
        lines.push(`    /** ${description} */`);
      }
      lines.push(`    ${propName}${optionalMarker}: ${tsType};`);
    }

    return lines.length > 0 ? lines.join('\n') : '    [key: string]: any;';
  }

  /**
   * Converts a JSON Schema to TypeScript interface definition.
   * This handles the most common JSON Schema patterns used in UTCP tools.
   * 
   * @param schema JSON Schema to convert
   * @param typeName Name for the generated TypeScript type
   * @returns TypeScript type definition as string
   */
  private jsonSchemaToTypeScript(schema: JsonSchema, typeName: string): string {
    if (!schema || typeof schema !== 'object') {
      return `type ${typeName} = any;`;
    }

    // Handle different schema types
    switch (schema.type) {
      case 'object':
        return this.objectSchemaToTypeScript(schema, typeName);
      case 'array':
        return this.arraySchemaToTypeScript(schema, typeName);
      case 'string':
        return this.primitiveSchemaToTypeScript(schema, typeName, 'string');
      case 'number':
      case 'integer':
        return this.primitiveSchemaToTypeScript(schema, typeName, 'number');
      case 'boolean':
        return this.primitiveSchemaToTypeScript(schema, typeName, 'boolean');
      case 'null':
        return `type ${typeName} = null;`;
      default:
        // Handle union types or fallback to any
        if (Array.isArray(schema.type)) {
          const types = schema.type.map(t => this.mapJsonTypeToTS(t)).join(' | ');
          return `type ${typeName} = ${types};`;
        }
        return `type ${typeName} = any;`;
    }
  }

  /**
   * Converts an object JSON Schema to TypeScript interface.
   */
  private objectSchemaToTypeScript(schema: JsonSchema, typeName: string): string {
    if (!schema.properties) {
      return `interface ${typeName} {
  [key: string]: any;
}`;
    }

    const properties = Object.entries(schema.properties).map(([key, propSchema]) => {
      const isRequired = schema.required?.includes(key) ?? false;
      const optional = isRequired ? '' : '?';
      const propType = this.jsonSchemaToTypeScriptType(propSchema);
      const description = propSchema.description ? `  /** ${propSchema.description} */\n` : '';
      
      return `${description}  ${key}${optional}: ${propType};`;
    }).join('\n');

    return `interface ${typeName} {
${properties}
}`;
  }

  /**
   * Converts an array JSON Schema to TypeScript type.
   */
  private arraySchemaToTypeScript(schema: JsonSchema, typeName: string): string {
    if (!schema.items) {
      return `type ${typeName} = any[];`;
    }

    const itemType = Array.isArray(schema.items) 
      ? schema.items.map(item => this.jsonSchemaToTypeScriptType(item)).join(' | ')
      : this.jsonSchemaToTypeScriptType(schema.items);

    return `type ${typeName} = (${itemType})[];`;
  }

  /**
   * Converts a primitive JSON Schema to TypeScript type with enum support.
   */
  private primitiveSchemaToTypeScript(schema: JsonSchema, typeName: string, baseType: string): string {
    if (schema.enum) {
      const enumValues = schema.enum.map(val => 
        typeof val === 'string' ? `"${val}"` : String(val)
      ).join(' | ');
      return `type ${typeName} = ${enumValues};`;
    }

    return `type ${typeName} = ${baseType};`;
  }

  /**
   * Converts a JSON Schema to a TypeScript type (not a full type definition).
   */
  private jsonSchemaToTypeScriptType(schema: JsonSchema): string {
    if (!schema || typeof schema !== 'object') {
      return 'any';
    }

    if (schema.enum) {
      return schema.enum.map(val => 
        typeof val === 'string' ? `"${val}"` : String(val)
      ).join(' | ');
    }

    switch (schema.type) {
      case 'object':
        if (!schema.properties) return '{ [key: string]: any }';
        const props = Object.entries(schema.properties).map(([key, propSchema]) => {
          const isRequired = schema.required?.includes(key) ?? false;
          const optional = isRequired ? '' : '?';
          const propType = this.jsonSchemaToTypeScriptType(propSchema);
          return `${key}${optional}: ${propType}`;
        }).join('; ');
        return `{ ${props} }`;
      
      case 'array':
        if (!schema.items) return 'any[]';
        const itemType = Array.isArray(schema.items)
          ? schema.items.map(item => this.jsonSchemaToTypeScriptType(item)).join(' | ')
          : this.jsonSchemaToTypeScriptType(schema.items);
        return `(${itemType})[]`;
      
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';
      
      default:
        if (Array.isArray(schema.type)) {
          return schema.type.map(t => this.mapJsonTypeToTS(t)).join(' | ');
        }
        return 'any';
    }
  }

  /**
   * Maps basic JSON Schema types to TypeScript types.
   */
  private mapJsonTypeToTS(type: string): string {
    switch (type) {
      case 'string': return 'string';
      case 'number':
      case 'integer': return 'number';
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      case 'object': return 'object';
      case 'array': return 'any[]';
      default: return 'any';
    }
  }
}
