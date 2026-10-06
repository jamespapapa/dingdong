// OpenClaw owns tool discovery, execution and tool-policy enforcement.
// The private callback leaves SQLite ownership with the Dingdong service.
export default {
  id: "dingdong",
  name: "Dingdong",
  description: "Persistent memory and automation for dots",
  register(api) {
    api.registerTool({
      name: "dingdong_tool",
      label: "Dingdong work tools",
      description:
        "Execute an authenticated Dingdong operation against its persistent work memory and automation store.",
      parameters: {
        type: "object",
        properties: {
          operation: { type: "string" },
          input: { type: "object", additionalProperties: true },
          actor: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        required: ["operation", "input", "actor"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const response = await fetch(
          `${process.env.DINGDONG_INTERNAL_URL}/internal/tool`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.DINGDONG_INTERNAL_KEY}`,
            },
            body: JSON.stringify(params),
            signal: AbortSignal.timeout(25000),
          },
        );
        const result = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
          isError: !response.ok,
        };
      },
    });
  },
};
