import express from 'express';
import { UtcpManual } from '../src/index';

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// UTCP Manual endpoint
app.get('/utcp', (req, res) => {
  const manual: UtcpManual = {
    name: 'Simple Example Server',
    description: 'A simple server demonstrating UTCP manual',
    version: '1.0.0',
    tools: [
      {
        name: 'echo',
        description: 'Echo back the input message',
        inputs: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to echo back'
            }
          },
          required: ['message']
        },
        outputs: {
          type: 'object',
          properties: {
            echo: {
              type: 'string',
              description: 'The echoed message'
            }
          }
        },
        tags: ['example', 'simple'],
        provider: {
          name: 'echo_provider',
          provider_type: 'http',
          url: `http://localhost:${PORT}/echo`,
          http_method: 'POST',
          content_type: 'application/json',
          body_field: 'body'
        }
      },
      {
        name: 'greet',
        description: 'Greet a person by name',
        inputs: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The name of the person to greet'
            }
          },
          required: ['name']
        },
        outputs: {
          type: 'object',
          properties: {
            greeting: {
              type: 'string',
              description: 'The greeting message'
            }
          }
        },
        tags: ['example', 'greeting'],
        provider: {
          name: 'greet_provider',
          provider_type: 'http',
          url: `http://localhost:${PORT}/greet`,
          http_method: 'POST',
          content_type: 'application/json',
          body_field: 'body'
        }
      }
    ]
  };

  res.json(manual);
});

// Tool implementations
app.post('/echo', (req, res) => {
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  res.json({ echo: message });
});

app.post('/greet', (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  res.json({ greeting: `Hello, ${name}! Welcome to UTCP!` });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 UTCP Example Server running on http://localhost:${PORT}`);
  console.log(`📖 UTCP Manual available at: http://localhost:${PORT}/utcp`);
  console.log(`🔧 Available tools:`);
  console.log(`   - Echo: POST http://localhost:${PORT}/echo`);
  console.log(`   - Greet: POST http://localhost:${PORT}/greet`);
  console.log(`❤️  Health check: GET http://localhost:${PORT}/health`);
});

export default app;
