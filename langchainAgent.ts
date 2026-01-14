import { createAgent, tool } from "langchain";
import { z } from "zod";

/**
 * Demo goal:
 * Unstructured message -> Structured support ticket JSON
 *
 * Keep it simple:
 * - one tool
 * - predictable output
 * - lightweight heuristics (regex + keywords)
 */

// A single, easy-to-understand output shape
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
    reference_ids: z.array(z.string()), // order/invoice/ticket ids etc
  }),
  flags: z.object({
    requires_callback: z.boolean(),
    mentions_attachment: z.boolean(),
  }),
  meta: z.object({
    extracted_at: z.string(),
  }),
});

const extractSupportTicketTool = tool(
  async ({ messageText }) => {
    const text = messageText.trim();
    const lower = text.toLowerCase();

    // --- simple contact extraction (regex) ---
    const email = text.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] ?? null;

    // supports: 123-456-7890, 123.456.7890, 1234567890, +31..., (light demo)
    const phone =
      text.match(
        /(\+\d{1,3}[\s-]?)?(\(?\d{2,4}\)?[\s-]?)?\d{3}[\s-.]?\d{4}/
      )?.[0] ?? null;

    // "I'm Jane Doe" / "my name is Jane Doe"
    const name =
      text.match(
        /(?:i'm|i am|this is|my name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i
      )?.[1] ?? null;

    // --- category + urgency (keyword heuristics) ---
    let category: "billing" | "technical" | "account" | "general" = "general";

    if (/(billing|invoice|payment|refund|charge)/i.test(text)) category = "billing";
    else if (/(login|password|error|bug|crash|access|2fa)/i.test(text))
      category = "technical";
    else if (/(account|profile|settings|subscription|plan)/i.test(text))
      category = "account";

    let urgency: "low" | "medium" | "high" = "medium";
    if (/(urgent|asap|immediately|today|right away)/i.test(text)) urgency = "high";
    if (/(no rush|whenever|at your convenience)/i.test(text)) urgency = "low";

    // --- super simple summary (first meaningful sentence or first 140 chars) ---
    const firstSentence =
      text
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .find((s) => s.length > 0) ?? "";

    const summary =
      (firstSentence.length > 0 ? firstSentence : text).slice(0, 140) ||
      "Customer inquiry";

    // --- entities (regex) ---
    const dates = text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g) ?? [];
    const amounts = text.match(/\$\d+(?:,\d{3})*(?:\.\d{2})?/g) ?? [];

    // references: order #ABC123, invoice 778899, ticket: ZXCVBN12
    const reference_ids =
      text
        .match(/(?:order|invoice|ticket|case)\s*[#:]?\s*([A-Za-z0-9-]{5,})/gi)
        ?.map((m) => m.replace(/^(order|invoice|ticket|case)\s*[#:]?\s*/i, "")) ??
      [];

    const requires_callback = /(call me|give me a call|phone me|reach me at)/i.test(
      text
    );
    const mentions_attachment = /(attach|attached|attachment)/i.test(text);

    const result = SupportTicketSchema.parse({
      customer: { name, email, phone },
      issue: { category, urgency, summary },
      entities: { dates, amounts, reference_ids },
      flags: { requires_callback, mentions_attachment },
      meta: { extracted_at: new Date().toISOString() },
    });

    return JSON.stringify(result, null, 2);
  },
  {
    name: "extract_support_ticket",
    description:
      "Turn an unstructured customer message into a structured support ticket JSON.",
    schema: z.object({
      messageText: z
        .string()
        .describe("The unstructured customer email/chat/support message"),
    }),
  }
);

export function createSimpleExtractionAgent() {
  return createAgent({
    model: "openai:gpt-4o-mini",
    tools: [extractSupportTicketTool],
    systemPrompt: `
You are a simple demo agent.
Goal: convert messy customer text into a structured support ticket JSON.

Rules:
- Always call extract_support_ticket exactly once.
- Return ONLY the JSON produced by the tool (no extra commentary). The user will provide a JSON object with keys messageText and ticketJson. Use them directly.
`,
  });
}

/**
 * Example usage (in your app):
 *
 * const agent = createSimpleExtractionAgent();
 * const result = await agent.invoke({
 *   messageText: "Hi I'm Jane Doe... I was charged $49.99 on 12/01/2025..."
 * });
 * console.log(result);
 */
