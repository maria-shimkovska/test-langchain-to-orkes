import { createAgent, tool } from "langchain";
import { z } from "zod";

/** Same schema as your extractor output */
const SupportTicketSchema = z.object({
  customer: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  issue: z.object({
    category: z.enum(["billing", "technical", "account", "general"]),
    urgency: z.enum(["low", "medium", "high"]),
    summary: z.string(),
  }),
  entities: z.object({
    dates: z.array(z.string()),
    amounts: z.array(z.string()),
    reference_ids: z.array(z.string()),
  }),
  flags: z.object({
    requires_callback: z.boolean(),
    mentions_attachment: z.boolean(),
  }),
  meta: z.object({
    extracted_at: z.string(),
  }),
});

function safeJsonParse(input: any): { ok: true; value: any } | { ok: false; error: string } {
  try {
    // ✅ If Conductor already gave us an object, use it directly
    if (input !== null && typeof input === "object") {
      return { ok: true, value: input };
    }

    // ✅ Otherwise parse as JSON string
    return { ok: true, value: JSON.parse(String(input)) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Invalid JSON" };
  }
}


const schemaEvalTool = tool(
  async ({ ticketJson }) => {
    const parsed = safeJsonParse(ticketJson);
    if (!parsed.ok) {
      return JSON.stringify(
        {
          evaluator: "schema",
          passed: false,
          score: 0,
          errors: [`Invalid JSON: ${parsed.error}`],
          warnings: [],
        },
        null,
        2
      );
    }

    const result = SupportTicketSchema.safeParse(parsed.value);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return JSON.stringify(
        { evaluator: "schema", passed: false, score: 0, errors, warnings: [] },
        null,
        2
      );
    }

    const warnings: string[] = [];
    if (result.data.issue.summary.trim().length < 10) warnings.push("summary_too_short");

    return JSON.stringify(
      {
        evaluator: "schema",
        passed: true,
        score: warnings.length ? 0.9 : 1.0,
        errors: [],
        warnings,
      },
      null,
      2
    );
  },
  {
    name: "evaluate_schema",
    description: "Validates the ticket JSON parses and matches the expected schema.",
    schema: z.object({
      ticketJson: z.string().describe("The JSON string produced by the extraction agent"),
    }),
  }
);

export function createSchemaEvalAgent() {
  return createAgent({
    model: "openai:gpt-4o-mini",
    tools: [schemaEvalTool],
    systemPrompt: `
You are a simple evaluation agent.
Call evaluate_schema exactly once.
Return ONLY the JSON from the tool. The user will provide a JSON object with ticketJson. Use it directly.`,
  });
}
