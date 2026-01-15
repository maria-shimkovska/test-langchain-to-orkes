import * as z from "zod";
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";

/**
 * Quality Eval
 * Goal: "Is this extraction useful and reasonable?"
 * - Not grounding (that's separate)
 * - Not schema (that's deterministic)
 * - This is a light semantic / usefulness check
 */

const QualityEvalSchema = z.object({
  evaluator: z.literal("quality"),
  passed: z.boolean(),
  score: z.number(), // 0..1
  errors: z.array(z.string()),
  notes: z.array(z.string()),
  suggested_fixes: z.array(z.string()),
});

export function createQualityEvalAgent() {
  const evalModel = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  });

  return createAgent({
    model: evalModel,
    tools: [],
    responseFormat: QualityEvalSchema,
    systemPrompt: `
You are a quality evaluation agent for a support-ticket extraction.

Input (in the user message) will be JSON with:
- messageText: string (original customer message)
- ticketJson: object or string (extracted ticket)

Your job:
Judge whether the extracted ticket is USEFUL and REASONABLE for downstream routing + support.

Focus on these:
1) Summary quality:
- Should be short but specific (mention the key problem)
- Should not be generic like "User needs help" if details exist

2) Category/urgency sanity:
- Category should fit the message at a high level
- Urgency should not be "high" without any sign of urgency

3) Completeness:
- If the message clearly contains key info (like an invoice ID or charge amount),
  the ticket should capture it somewhere (entities or summary)

Scoring:
- Start at 1.0
- Subtract 0.25 for each major issue (max 4)
- score = max(0, score)
- passed = (score >= 0.75)

Output:
- errors: major issues (reasons it should fail)
- notes: minor observations (nice-to-have improvements)
- suggested_fixes: concrete improvements the extractor should make next time

Return ONLY the structured object. No extra text.
    `.trim(),
  });
}

/** Demo */
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const agent = createQualityEvalAgent();

  const input = {
    messageText: "Hi, I'm Jane Doe. I was charged $49.99 on 12/01/2025 for invoice ABC123.",
    ticketJson: {
      customer: { name: "Jane Doe", email: null, phone: null },
      issue: { category: "general", urgency: "high", summary: "User needs help." },
      entities: { dates: [], amounts: [], reference_ids: [] },
      flags: { requires_callback: false, mentions_attachment: false },
      meta: { extracted_at: "2026-01-14T22:10:31.150Z" },
    },
  };

  agent
    .invoke({ messages: [{ role: "user", content: JSON.stringify(input) }] })
    .then((res) => console.log(JSON.stringify(res.structuredResponse ?? res, null, 2)));
}
