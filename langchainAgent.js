import * as z from "zod";
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";

/**
 * Goal:
 * Unstructured customer message → structured support ticket JSON
 * Use createAgent() + responseFormat so it matches your eval agents and LangChain docs.
 */

export const SupportTicketSchema = z.object({
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

export function createSimpleExtractionAgent() {
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  });

  return createAgent({
    model,
    tools: [],
    responseFormat: SupportTicketSchema,
    systemPrompt: `
You extract structured support tickets from messy customer messages.

Rules:
- Never invent customer details. Use null if not explicitly present.
- If unsure, choose issue.category="general" and issue.urgency="medium".
- issue.summary should be short and human-readable.
- entities should be strings copied from the text when possible (do not reformat dates/amounts).
- flags.requires_callback should be true if the user asks to be called.
- flags.mentions_attachment should be true if the user mentions an attachment/screenshot.
- meta.extracted_at MUST be the current time in ISO 8601 format (new Date().toISOString()).
Return ONLY the structured object (no extra text).
    `.trim(),
  });
}

// Demo runner
export async function runSimpleExtractionAgentDemo() {
  const agent = createSimpleExtractionAgent();

  const messageText = `
Hi, I'm Jane Doe. I was charged $4109.90 on 12/01/2025 for invoice ABC123. My email is m@gmail.com.
This is urgent — please call me if you need more info.
  `.trim();

  const result = await agent.invoke({
    messages: [{ role: "user", content: messageText }],
  });

  // responseFormat => result.structuredResponse contains the object
  console.log("Extraction Result:");
  console.log(JSON.stringify(result.structuredResponse ?? result, null, 2));
}

// Run when executed directly (ESM-safe)
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  runSimpleExtractionAgentDemo();
}
//  You can run this file directly with `node langchainAgent.js`