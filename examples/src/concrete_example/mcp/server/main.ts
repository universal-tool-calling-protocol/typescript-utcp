import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { z } from "zod";
import dotenv from "dotenv";

const server = new McpServer({
  name: "demo-server",
  version: "1.0.0"
});

dotenv.config();

server.registerTool("theirstack.jobs",
  {
    title: "Jobs Search",
    description: "Search for jobs using Theirstack API",
    inputSchema: {
      page: z.number(),
      limit: z.number(),
      job_country_code_or: z.array(z.string()),
      posted_at_max_age_days: z.number()
    }
  },
  async ({ page, limit, job_country_code_or, posted_at_max_age_days }) => {
    const headers = {
      Authorization: `Bearer ${process.env.THEIRSTACK_API_TOKEN}`,
      'Content-Type': 'application/json',
    };

    const payload = {
      limit,
      page,
      job_country_code_or,
      posted_at_max_age_days,
    };

    try {
      const response = await axios.post('https://api.theirstack.com/v1/jobs/search', payload, { headers });
      
      return {
        content: [{type: "text", text: JSON.stringify(response.data)}]
      }
    } catch (error: any) {
      const status = error.response?.status;
      const data = error.response?.data;
      return {
        content: [{type: "text", text: JSON.stringify({
          error: error.message || "An error occurred while fetching jobs.",
          detail: {
            detail: status === 422 ? data.detail : data || {}
          }
        })}]
      }
    }
  }
);

const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();