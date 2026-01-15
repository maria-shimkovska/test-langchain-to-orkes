import * as z from "zod";
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";

/** Same schema as extractor output */
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

/** Output shape for schema eval */
const SchemaEvalSchema = z.object({
  evaluator: z.literal("schema"),
  passed: z.boolean(),
  score: z.number(),
  errors: z.array(z.string()),
  mismatches: z.array(
    z.object({
      path: z.string(),          // e.g. "issue.urgency"
      expected: z.string(),      // e.g. "one of: low|medium|high"
      got: z.string().nullable() // e.g. "urgent" or "null" or "missing"
    })
  ),
});

function safeJsonParse(input) {
  try {
    if (input !== null && typeof input === "object") return { ok: true, value: input };
    return { ok: true, value: JSON.parse(String(input)) };
  } catch (e) {
    return { ok: false, error: e?.message ?? "Invalid JSON" };
  }
}

function zodIssuesToMismatches(issues) {
  return issues.map((iss) => ({
    path: iss.path?.length ? iss.path.join(".") : "(root)",
    expected: iss.message, // zod gives readable expectation messages
    got: null,
  }));
}

export function createSchemaEvalAgent() {
  const evalModel = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  });

  return createAgent({
    model: evalModel,
    tools: [],
    responseFormat: SchemaEvalSchema,
    systemPrompt: `
You are a schema evaluation agent.

You will receive JSON with:
- ticketJson: the extracted ticket
- schemaResult: the result of a strict schema validation already computed for you

Your job:
- Return ONLY the structured evaluation object:
  { evaluator, passed, score, errors, mismatches }

Rules:
- If schemaResult.ok is false => passed=false, score=0, errors must include the reason.
- If schemaResult.ok is true but schemaResult.valid is false => passed=false, score=0, errors=["Schema mismatch"], mismatches=provided issues.
- If schemaResult.valid is true => passed=true, score=1, errors=[], mismatches=[].

Do not add extra keys. Do not add extra commentary.
    `.trim(),
  });
}

export async function runSchemaEval({ ticketJson }) {
  // 1) Parse / validate locally (the actual schema check)
  const parsed = safeJsonParse(ticketJson);
  if (!parsed.ok) {
    const agent = createSchemaEvalAgent();
    const payload = {
      ticketJson,
      schemaResult: {
        ok: false,
        reason: `Invalid JSON: ${parsed.error}`,
        valid: false,
        mismatches: [],
      },
    };

    const result = await agent.invoke({
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });

    return result.structuredResponse ?? result;
  }

  const validated = SupportTicketSchema.safeParse(parsed.value);

  const schemaResult = validated.success
    ? { ok: true, reason: null, valid: true, mismatches: [] }
    : {
        ok: true,
        reason: null,
        valid: false,
        mismatches: zodIssuesToMismatches(validated.error.issues),
      };

  // 2) Call LLM agent to emit the final structured eval result
  const agent = createSchemaEvalAgent();
  const payload = { ticketJson: parsed.value, schemaResult };

  const result = await agent.invoke({
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });

  return result.structuredResponse ?? result;
}

/** Demo */
export async function runSchemaEvalDemo() {
  const goodTicket = {
    customer: { name: "Jane Doe", email: null, phone: null },
    issue: { category: "billing", urgency: "high", summary: "Charged for invoice." },
    entities: { dates: ["12/01/2025"], amounts: ["$49.99"], reference_ids: ["ABC123"] },
    flags: { requires_callback: false, mentions_attachment: false },
    meta: { extracted_at: "2026-01-14T22:10:31.150Z" },
  };

  const badTicket = {
    customer: { name: "Jane Doe", email: null, phone: null },
    issue: { category: "billing", urgency: "URGENT", summary: "Charged for invoice." }, // invalid urgency
    entities: { dates: ["12/01/2025"], amounts: ["$49.99"], reference_ids: ["ABC123"] },
    flags: { requires_callback: false, mentions_attachment: false },
    meta: { extracted_at: "2026-01-14T22:10:31.150Z" },
  };

  console.log("GOOD:");
  console.log(JSON.stringify(await runSchemaEval({ ticketJson: goodTicket }), null, 2));

  console.log("\nBAD:");
  console.log(JSON.stringify(await runSchemaEval({ ticketJson: badTicket }), null, 2));
}

// Run when executed directly (ESM-safe)
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  runSchemaEvalDemo();
}
