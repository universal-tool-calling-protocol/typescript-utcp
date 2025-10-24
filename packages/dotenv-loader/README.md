# @utcp/dotenv-loader

DotEnv Variable Loader plugin for the Universal Tool Calling Protocol (UTCP).

## Overview

This plugin provides support for loading environment variables from `.env` files in UTCP applications. It's useful for Node.js environments where you want to manage configuration through environment files.

## Installation

```bash
npm install @utcp/dotenv-loader
```

## Usage

The plugin automatically registers itself when imported:

```typescript
import '@utcp/dotenv-loader';
import { UtcpClient } from '@utcp/sdk';

// Now you can use dotenv variable loaders in your UTCP configuration
const config = {
  load_variables_from: [
    {
      variable_loader_type: 'dotenv',
      env_file_path: '.env'
    }
  ]
};

const client = await UtcpClient.create(process.cwd(), config);
```

## Configuration

The DotEnv Variable Loader accepts the following configuration:

- `variable_loader_type`: Must be set to `'dotenv'`
- `env_file_path`: Path to the `.env` file (relative to the root directory)

## Features

- **Automatic Registration**: Plugin registers itself on import
- **Dynamic Loading**: Reads .env file on every variable access
- **Silent Failure**: Returns `null` if file doesn't exist or can't be read
- **Standard .env Format**: Supports standard dotenv file format

## Example .env File

```env
API_KEY=your-api-key-here
DATABASE_URL=postgresql://localhost:5432/mydb
DEBUG=true
```

## Note

This plugin requires Node.js as it uses the `fs` module. It's not suitable for browser environments. For browser applications, use inline variable configuration instead.

## License

MPL-2.0
