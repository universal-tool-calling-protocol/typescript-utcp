import { describe, test, expect } from "bun:test";
import { UtcpClient, UtcpClientConfigSerializer } from "@utcp/sdk";
import type { CallTemplate, Tool } from "@utcp/sdk";

const postProcessing = [
  { tool_post_processor_type: "filter_dict", exclude_keys: ["secret"], only_include_manuals: ["demo"] },
];
const tool = { name: "demo.tool" } as Tool;
const manual = { name: "demo", call_template_type: "text" } as CallTemplate;
const result = { kept: 1, secret: 2, nested: { secret: 3, kept: 4 } };

async function filteredResult(client: UtcpClient) {
  expect(client.postProcessors).toHaveLength(1);
  return client.postProcessors[0].postProcess(client, tool, manual, result);
}

describe("post_processing from the client config", () => {
  test("keeps its settings when the config is a plain dict", async () => {
    const client = await UtcpClient.create(process.cwd(), { post_processing: postProcessing } as any);
    expect(await filteredResult(client)).toEqual({ kept: 1, nested: { kept: 4 } });
    await client.close();
  });

  test("keeps its settings when the config was already validated", async () => {
    const config = new UtcpClientConfigSerializer().validateDict({ post_processing: postProcessing });
    const client = await UtcpClient.create(process.cwd(), config);
    expect(await filteredResult(client)).toEqual({ kept: 1, nested: { kept: 4 } });
    await client.close();
  });

  test("serializes back to the original settings", async () => {
    const config = new UtcpClientConfigSerializer().validateDict({ post_processing: postProcessing });
    const client = await UtcpClient.create(process.cwd(), config);
    expect(new UtcpClientConfigSerializer().toDict(client.config).post_processing).toEqual([
      expect.objectContaining({ exclude_keys: ["secret"], only_include_manuals: ["demo"] }),
    ]);
    await client.close();
  });
});
