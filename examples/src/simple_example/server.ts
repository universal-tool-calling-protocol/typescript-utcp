import express from 'express';
import { HttpProvider } from '../../../src/shared/provider';
import { Tool } from '../../../src/shared/tool';
import { UtcpManual } from '../../../src/shared/utcp-manual';

const app = express();
app.use(express.json());

const PORT = 8080;
const __version__ = '0.1.0';
const BASE_PATH = `http://localhost:${PORT}`;

// Manually define the tool
const testTool: Tool = {
  name: 'test_endpoint',
  description: 'A simple test endpoint that echoes a value.',
  tags: ['test', 'example'],
  tool_provider: {
    name: 'test_provider',
    provider_type: 'http',
    url: `${BASE_PATH}/test`,
    http_method: 'POST',
  } as HttpProvider,
  inputs: {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'A string value to be echoed back.' },
    },
    required: ['value'],
  },
  outputs: {
    type: 'object',
    properties: {
      received: { type: 'string', description: 'The value that was received by the tool.' },
    },
    required: ['received'],
  },
};

// Manually construct the UTCP manual
const manual: UtcpManual = {
  version: __version__,
  tools: [testTool],
};

// Endpoint to serve the UTCP manual
app.get('/utcp', (req, res) => {
  res.json(manual);
});

// The actual tool endpoint
app.post('/test', (req, res) => {
  const { value } = req.body;

  if (typeof value !== 'string') {
    return res.status(400).json({ error: 'Invalid input: value must be a string.' });
  }

  return res.json({ received: value });
});

app.listen(PORT, () => {
  console.log(`UTCP example server running at ${BASE_PATH}`);
});
