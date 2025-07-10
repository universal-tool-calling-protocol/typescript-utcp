# TypeScript UTCP - Full LLM Example

This example demonstrates how to integrate the UTCP library with OpenAI's language models to create a smart assistant that can use tools via the UTCP protocol.

## Overview

This example shows:
1. Initializing a UTCP client with tool providers from a configuration file
2. Searching for relevant tools based on user queries
3. Instructing OpenAI to generate tool calls in JSON format
4. Executing the tool calls using the UTCP client
5. Sending tool results back to OpenAI for interpretation

## Prerequisites

- Node.js installed
- OpenAI API key
- NewsAPI key (optional, for accessing NewsAPI tools)

## Setup

1. Install the required dependencies:
   ```bash
   npm install openai dotenv
   ```

2. Create a `.env` file by copying `example.env` and adding your API keys:
   ```bash
   # Copy the example.env to .env
   cp example.env .env
   
   # Edit the .env file and add your API keys
   ```

3. Make sure your `.env` file contains:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   NEWS_API_KEY=your_news_api_key_here  # Optional, only if you want to use NewsAPI
   ```

## Running the Example

Execute the example with:

```bash
npx ts-node examples/src/full_llm_example/openai_utcp_example.ts
```

## How It Works

1. The example initializes the UTCP client and loads tool providers from `providers.json`
2. For each user input, it searches for relevant tools using the UTCP client
3. It then sends a request to OpenAI with available tools to get a tool call
4. If OpenAI returns a valid tool call, it executes the tool using UTCP
5. Finally, it sends the tool results back to OpenAI for interpretation

## Available Tools

This example includes access to:

- OpenLibrary API
- NewsAPI (requires API key)
- OpenAI API (requires API key)
