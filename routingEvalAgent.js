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

/** Output schema (IMPORTANT: no z.any() for OpenAI structured outputs) */
const RoutingEvalSchema = z.object({
  evaluator: z.literal("routing"),
  passed: z.boolean(),
  score: z.number(),
  errors: z.array(z.string()),
  mismatches: z.array(
    z.object({
      rule: z.string(),
      expected: z.string(),           // <-- must be typed
      got: z.string().nullable(),     // <-- must be typed
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

export function createRoutingEvalAgent() {
  const evalModel = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  });

  return createAgent({
    model: evalModel,
    tools: [],
    responseFormat: RoutingEvalSchema,
    systemPrompt: `
You are a routing evaluation agent.

Goal:
Sanity-check whether ticketJson.issue.category, ticketJson.issue.urgency,
and ticketJson.flags align with obvious routing signals in messageText.

Input (user message JSON):
- messageText: string
- ticketJson: object

Keyword-based expectations:

Category signals:
- billing, invoice, payment, refund, charge -> category "billing"
- login, password, error, bug, crash, access, 2fa -> category "technical"
- account, profile, settings, subscription, plan -> category "account"

Urgency signals:
- urgent, asap, immediately, today, right away -> urgency "high"
- no rush, whenever, at your convenience -> urgency "low"

Flag signals:
- call me, give me a call, phone me, reach me at -> flags.requires_callback = true
- attach, attached, attachment -> flags.mentions_attachment = true

Rules:
- Only add a mismatch when a keyword signal is present AND ticketJson disagrees.
- Use these rule names exactly:
  - billing_keywords_imply_billing
  - technical_keywords_imply_technical
  - account_keywords_imply_account
  - urgent_keywords_imply_high
  - low_keywords_imply_low
  - callback_keywords_imply_requires_callback
  - attachment_keywords_imply_mentions_attachment

Mismatch format:
mismatches[] items must be:
{ "rule": "<rule_name>", "expected": "<string>", "got": "<string|null>" }

IMPORTANT:
- expected MUST be a string (example: "billing", "high", "true")
- got MUST be a string or null (example: "general", "medium", "false", or null)

Scoring:
- score = max(0, 1 - 0.15 * mismatches.length)
- passed = (mismatches.length === 0)
- errors = [] unless input is invalid

Return ONLY the structured routing evaluation object.
    `.trim(),
  });
}

export async function runRoutingEval({ messageText, ticketJson }) {
  const parsed = safeJsonParse(ticketJson);
  if (!parsed.ok) {
    return {
      evaluator: "routing",
      passed: false,
      score: 0,
      errors: [`Invalid JSON: ${parsed.error}`],
      mismatches: [],
    };
  }

  const validated = SupportTicketSchema.safeParse(parsed.value);
  if (!validated.success) {
    return {
      evaluator: "routing",
      passed: false,
      score: 0,
      errors: ["Schema mismatch (run schema eval for details)"],
      mismatches: [],
    };
  }

  const agent = createRoutingEvalAgent();

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          messageText: messageText ?? "",
          ticketJson: validated.data,
        }),
      },
    ],
  });

  return result.structuredResponse ?? result;
}

/** Demo */
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const input = {
    messageText:
      "Hi — I can’t log in. I keep getting a 2FA error and it’s urgent. Please call me back today.",
    ticketJson: {
      customer: { name: null, email: null, phone: null },
      issue: { category: "technical", urgency: "high", summary: "User needs help." },
      entities: { dates: [], amounts: [], reference_ids: [] },
      flags: { requires_callback: true, mentions_attachment: false },
      meta: { extracted_at: new Date().toISOString() },
    },
  };

  runRoutingEval(input).then((out) => console.log(JSON.stringify(out, null, 2)));
}
