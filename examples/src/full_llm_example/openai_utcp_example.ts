/**
 * UTCP OpenAI Integration Example
 *
 * This example demonstrates how to:
 * 1. Initialize a UTCP client with tool providers from a config file
 * 2. For each user request, search for relevant tools.
 * 3. Instruct OpenAI to respond with a JSON for a tool call.
 * 4. Parse the JSON and execute the tool call using the UTCP client.
 * 5. Return the results to OpenAI for a final response.
 *
 * IMPORTANT: Before running this example, install OpenAI package: 
 * npm install openai dotenv
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
// Note: You need to install OpenAI package first: npm install openai
import { OpenAI } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources';
import dotenv from 'dotenv';

import { UtcpClient } from '../../../src/client/utcp-client';
import { UtcpClientConfig } from '../../../src/client/utcp-client-config';
import { Tool } from '../../../src/shared/tool';

/**
 * Initialize the UTCP client with configuration.
 */
async function initializeUtcpClient(): Promise<UtcpClient> {
  // Create a configuration for the UTCP client
  const config: UtcpClientConfig = {
    variables: {},
    providers_file_path: path.join(__dirname, 'providers.json'),
    load_variables_from: [
      {
        type: 'dotenv',
        env_file_path: path.join(__dirname, '.env')
      }
    ]
  };
  
  // Create and return the UTCP client
  const client = await UtcpClient.create(config);
  return client;
}

/**
 * Convert UTCP tools to a JSON string for the prompt.
 */
function formatToolsForPrompt(tools: Tool[]): string {
  return JSON.stringify(tools, null, 2);
}

/**
 * Get a response from OpenAI.
 */
async function getOpenAIResponse(messages: ChatCompletionMessageParam[]): Promise<string> {
  const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  
  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages,
  });
  
  return response.choices[0]!!.message.content || '';
}

/**
 * Create readline interface for user input
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Get user input from command line
 */
async function getUserInput(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Main function to demonstrate OpenAI with UTCP integration.
 */
async function main() {
  // Load environment variables
  dotenv.config({ path: path.join(__dirname, '.env') });
  
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY not found in environment variables");
    console.error("Please set it in the .env file");
    process.exit(1);
  }
  
  console.log("Initializing UTCP client...");
  const utcpClient = await initializeUtcpClient();
  console.log("UTCP client initialized successfully.");

  const conversationHistory: ChatCompletionMessageParam[] = [];
  const rl = createReadlineInterface();

  try {
    while (true) {
      const userPrompt = await getUserInput(rl, "\nEnter your prompt (or 'exit' to quit): ");
      if (userPrompt.toLowerCase() === 'exit' || userPrompt.toLowerCase() === 'quit') {
        break;
      }

      console.log("\nSearching for relevant tools...");
      const relevantTools = await utcpClient.search_tools(userPrompt, 10);
      
      if (relevantTools.length > 0) {
        console.log(`Found ${relevantTools.length} relevant tools.`);
        for (const tool of relevantTools) {
          console.log(`- ${tool.name}`);
        }
      } else {
        console.log("No relevant tools found.");
      }

      const toolsJsonString = formatToolsForPrompt(relevantTools);

      const systemPrompt = 
        "You are a helpful assistant. When you need to use a tool, you MUST respond with a JSON object " +
        "with 'tool_name' and 'arguments' keys. Do not add any other text. The arguments must be a JSON object." +
        "For example: {\"tool_name\": \"some_tool.name\", \"arguments\": {\"arg1\": \"value1\"}}. " +
        `Here are the available tools:\n${toolsJsonString}`;
      
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory,
        { role: "user", content: userPrompt }
      ];

      console.log("\nSending request to OpenAI...");
      const assistantResponse = await getOpenAIResponse(messages);

      // Try to parse JSON from the response (either in code blocks or directly)
      const jsonMatch = assistantResponse.match(/```json\n({.*?})\n```/s) || 
                         assistantResponse.match(/({.*})/s);

      if (jsonMatch) {
        const jsonString = jsonMatch[1] || '';
        try {
          const toolCallData = JSON.parse(jsonString);
          if ("tool_name" in toolCallData && "arguments" in toolCallData) {
            const toolName = toolCallData.tool_name;
            const arguments_ = toolCallData.arguments;
            
            console.log(`\nExecuting tool call: ${toolName}`);
            console.log(`Arguments: ${JSON.stringify(arguments_, null, 2)}`);

            let toolOutput: string;
            try {
              const result = await utcpClient.call_tool(toolName, arguments_);
              console.log('Result:', JSON.stringify(result, null, 2));
              toolOutput = JSON.stringify(result);
            } catch (e) {
              const errorMessage = `Error calling ${toolName}: ${e instanceof Error ? e.message : String(e)}`;
              console.error(`Error: ${errorMessage}`);
              toolOutput = errorMessage;
            }

            // Add user prompt and assistant's response to history
            conversationHistory.push({ role: "user", content: userPrompt });
            conversationHistory.push({ role: "assistant", content: assistantResponse });

            console.log("\nSending tool results to OpenAI for interpretation...");
            
            // Create a new list of messages for the follow-up, adding the tool output as a new user message
            const followUpMessages: ChatCompletionMessageParam[] = [
              { role: "system", content: systemPrompt },
              ...conversationHistory,
              // Provide the tool's output as a new user message for the model to process
              { role: "user", content: `Tool output: ${toolOutput}` }
            ];

            const finalResponse = await getOpenAIResponse(followUpMessages);
            console.log(`\nAssistant's interpretation: ${finalResponse}`);
            conversationHistory.push({ role: "assistant", content: finalResponse });
          } else {
            console.log(`\nAssistant: ${assistantResponse}`);
            conversationHistory.push({ role: "user", content: userPrompt });
            conversationHistory.push({ role: "assistant", content: assistantResponse });
          }
        } catch (e) {
          console.log(`\nAssistant: ${assistantResponse}`);
          conversationHistory.push({ role: "user", content: userPrompt });
          conversationHistory.push({ role: "assistant", content: assistantResponse });
        }
      } else {
        console.log(`\nAssistant: ${assistantResponse}`);
        conversationHistory.push({ role: "user", content: userPrompt });
        conversationHistory.push({ role: "assistant", content: assistantResponse });
      }
    }
  } finally {
    rl.close();
  }
}

// Run the main function
if (require.main === module) {
  main().catch(err => {
    console.error('Error in main:', err);
    process.exit(1);
  });
}
