import * as z from "zod";
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";

/**
 * Grounding (Sanity) Eval
 * Goal: "Does the extracted ticket stay grounded in the original message?"
 */

const GroundingEvalSchema = z.object({
  evaluator: z.literal("grounding"),
  passed: z.boolean(),
  score: z.number(), // 0..1
  errors: z.array(z.string()),
  unsupported_claims: z.array(z.string()),
});

export function createGroundingEvalAgent() {
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  });

  return createAgent({
    model,
    tools: [],
    responseFormat: GroundingEvalSchema,
    systemPrompt: `
You are a grounding evaluation agent.

Input (user message JSON):
- messageText: the original customer message
- ticketJson: the extracted support ticket (object)

Your task:
Check whether the ticket is CONSISTENT with the message.

Flag an "unsupported claim" when the ticket states something specific that is NOT supported by the message.

Examples of unsupported claims:
- customer email/phone/name not present in the message
- mentions amounts, dates, or reference IDs not present
- summary claims facts not stated
- category or urgency that clearly contradict the message

Rules:
- Be conservative: if the message is vague, do NOT flag it.
- Null or empty fields are NOT unsupported claims.
- Only flag clear inventions or contradictions.

Scoring:
- score starts at 1
- subtract 0.25 per unsupported claim (max 4)
- score = max(0, score)
- passed = (unsupported_claims.length === 0)
- errors = [] if passed else ["One or more claims in the ticket are not supported by the message."]

Return ONLY the structured object. No extra text.
    `.trim(),
  });
}

/** Demo */
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const agent = createGroundingEvalAgent();

  const input = {
    messageText:
      "Hello, I think there might be an issue with my account or billing. My name is Sarah Jade. You can email me at sarah.j@example.com.",
    ticketJson: {
      customer: { name: "Sarah Jade", email: "sarah.j@example.com", phone: null },
      issue: { category: "billing", urgency: "medium", summary: "Question about recent charge" },
      entities: { dates: [], amounts: [], reference_ids: [] },
      flags: { requires_callback: false, mentions_attachment: false },
      meta: { extracted_at: "2026-01-15T12:00:00Z" },
    },
  };

  agent
    .invoke({ messages: [{ role: "user", content: JSON.stringify(input) }] })
    .then((res) => console.log(JSON.stringify(res.structuredResponse ?? res, null, 2)));
}
