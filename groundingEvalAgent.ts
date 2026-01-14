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


function normalizePhone(s: string) {
  return s.replace(/\D/g, "");
}

function includesLoose(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

const groundingEvalTool = tool(
  async ({ messageText, ticketJson }) => {
    const parsed = safeJsonParse(ticketJson);
    if (!parsed.ok) {
      return JSON.stringify(
        {
          evaluator: "grounding",
          passed: false,
          score: 0,
          errors: [`Invalid JSON: ${parsed.error}`],
          hallucinations: [],
          field_checks: [],
        },
        null,
        2
      );
    }

    const validated = SupportTicketSchema.safeParse(parsed.value);
    if (!validated.success) {
      return JSON.stringify(
        {
          evaluator: "grounding",
          passed: false,
          score: 0,
          errors: ["Schema mismatch (run schema eval for details)"],
          hallucinations: [],
          field_checks: [],
        },
        null,
        2
      );
    }

    const ticket: SupportTicket = validated.data;
    const text = messageText ?? "";
    const field_checks: Array<{
      field: string;
      value: string | null;
      supported: boolean;
      evidence: string | null;
      severity: "error" | "warning";
    }> = [];

    const hallucinations: string[] = [];

    function checkContains(field: string, value: string | null, severity: "error" | "warning" = "error") {
      if (!value) return;

      const supported = includesLoose(text, value);
      field_checks.push({
        field,
        value,
        supported,
        evidence: supported ? value : null,
        severity,
      });

      if (!supported && severity === "error") hallucinations.push(`${field}: "${value}" not found in message`);
    }

    // Email
    checkContains("customer.email", ticket.customer.email, "error");

    // Phone (digits-only match)
    if (ticket.customer.phone) {
      const msgDigits = normalizePhone(text);
      const phoneDigits = normalizePhone(ticket.customer.phone);
      const supported = phoneDigits.length >= 7 && msgDigits.includes(phoneDigits);

      field_checks.push({
        field: "customer.phone",
        value: ticket.customer.phone,
        supported,
        evidence: supported ? ticket.customer.phone : null,
        severity: "error",
      });

      if (!supported) hallucinations.push(`customer.phone: "${ticket.customer.phone}" not supported by digits in message`);
    }

    // Name: warning-only (names are hard to reliably ground with substring rules)
    checkContains("customer.name", ticket.customer.name, "warning");

    // Arrays must be grounded
    for (const amt of ticket.entities.amounts) checkContains("entities.amounts[]", amt, "error");
    for (const dt of ticket.entities.dates) checkContains("entities.dates[]", dt, "error");
    for (const rid of ticket.entities.reference_ids) checkContains("entities.reference_ids[]", rid, "error");

    const errorChecks = field_checks.filter((c) => c.severity === "error");
    const supportedErrors = errorChecks.filter((c) => c.supported).length;
    const totalErrors = errorChecks.length;

    const score = totalErrors === 0 ? 1 : supportedErrors / totalErrors;
    const passed = hallucinations.length === 0;

    return JSON.stringify(
      {
        evaluator: "grounding",
        passed,
        score: Number(score.toFixed(2)),
        errors: passed ? [] : ["One or more extracted values are not supported by the message text."],
        hallucinations,
        field_checks,
      },
      null,
      2
    );
  },
  {
    name: "evaluate_grounding",
    description: "Checks that extracted values are supported by the original message (anti-hallucination).",
    schema: z.object({
      messageText: z.string().describe("Original unstructured message text"),
      ticketJson: z.string().describe("The JSON string produced by the extraction agent"),
    }),
  }
);

export function createGroundingEvalAgent() {
  return createAgent({
    model: "openai:gpt-4o-mini",
    tools: [groundingEvalTool],
    systemPrompt: `
You are a simple evaluation agent.
Call evaluate_grounding exactly once.
Return ONLY the JSON from the tool. The user will provide a JSON object with keys messageText and ticketJson. Use them directly.`,
  });
}
