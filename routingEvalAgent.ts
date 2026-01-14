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

type SupportTicket = z.infer<typeof SupportTicketSchema>;

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


const routingEvalTool = tool(
  async ({ messageText, ticketJson }) => {
    const parsed = safeJsonParse(ticketJson);
    if (!parsed.ok) {
      return JSON.stringify(
        {
          evaluator: "routing",
          passed: false,
          score: 0,
          errors: [`Invalid JSON: ${parsed.error}`],
          mismatches: [],
        },
        null,
        2
      );
    }

    const validated = SupportTicketSchema.safeParse(parsed.value);
    if (!validated.success) {
      return JSON.stringify(
        {
          evaluator: "routing",
          passed: false,
          score: 0,
          errors: ["Schema mismatch (run schema eval for details)"],
          mismatches: [],
        },
        null,
        2
      );
    }

    const ticket: SupportTicket = validated.data;
    const text = (messageText ?? "").toLowerCase();

    const billingHit = /(billing|invoice|payment|refund|charge)/i.test(text);
    const technicalHit = /(login|password|error|bug|crash|access|2fa)/i.test(text);
    const accountHit = /(account|profile|settings|subscription|plan)/i.test(text);

    const urgentHit = /(urgent|asap|immediately|today|right away)/i.test(text);
    const lowHit = /(no rush|whenever|at your convenience)/i.test(text);

    const callbackHit = /(call me|give me a call|phone me|reach me at)/i.test(text);
    const attachHit = /(attach|attached|attachment)/i.test(text);

    const mismatches: Array<{ rule: string; expected: any; got: any }> = [];

    // Category expectations (only when strong signals exist)
    if (billingHit && ticket.issue.category !== "billing") {
      mismatches.push({ rule: "billing_keywords_imply_billing", expected: "billing", got: ticket.issue.category });
    }
    if (technicalHit && ticket.issue.category !== "technical") {
      mismatches.push({ rule: "technical_keywords_imply_technical", expected: "technical", got: ticket.issue.category });
    }
    if (accountHit && ticket.issue.category !== "account") {
      mismatches.push({ rule: "account_keywords_imply_account", expected: "account", got: ticket.issue.category });
    }

    // Urgency expectations
    if (urgentHit && ticket.issue.urgency !== "high") {
      mismatches.push({ rule: "urgent_keywords_imply_high", expected: "high", got: ticket.issue.urgency });
    }
    if (lowHit && ticket.issue.urgency !== "low") {
      mismatches.push({ rule: "low_keywords_imply_low", expected: "low", got: ticket.issue.urgency });
    }

    // Flag expectations
    if (callbackHit && ticket.flags.requires_callback !== true) {
      mismatches.push({
        rule: "callback_keywords_imply_requires_callback",
        expected: true,
        got: ticket.flags.requires_callback,
      });
    }
    if (attachHit && ticket.flags.mentions_attachment !== true) {
      mismatches.push({
        rule: "attachment_keywords_imply_mentions_attachment",
        expected: true,
        got: ticket.flags.mentions_attachment,
      });
    }

    const score = Math.max(0, 1 - mismatches.length * 0.15);
    const passed = mismatches.length === 0;

    return JSON.stringify(
      {
        evaluator: "routing",
        passed,
        score: Number(score.toFixed(2)),
        errors: [],
        mismatches,
      },
      null,
      2
    );
  },
  {
    name: "evaluate_routing",
    description: "Sanity checks category/urgency/flags against obvious keywords for routing usefulness.",
    schema: z.object({
      messageText: z.string().describe("Original unstructured message text"),
      ticketJson: z.string().describe("The JSON string produced by the extraction agent"),
    }),
  }
);

export function createRoutingEvalAgent() {
  return createAgent({
    model: "openai:gpt-4o-mini",
    tools: [routingEvalTool],
    systemPrompt: `
You are a simple evaluation agent.
Call evaluate_routing exactly once.
Return ONLY the JSON from the tool. The user will provide a JSON object with keys messageText and ticketJson. Use them directly.`,
  });
}
