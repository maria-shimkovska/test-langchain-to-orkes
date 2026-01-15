# Orkes for LangChain/LangGraph Agent Orchestration & Evals

This workflow shows how Orkes Conductor powers complex, AI-driven processes while keeping them easy to understand and manage in the UI.

A customer message first goes through an AI extraction step that turns unstructured text into structured data.

That result is then automatically evaluated in parallel by multiple AI agents (checking things like accuracy, schema correctness, and routing quality). All evaluations are aggregated and a clear pass/fail decision is made.

If everything passes, the workflow proceeds automatically and saves the result. If anything looks off, the workflow intelligently routes the case to a human reviewer, with full context and reasons clearly visible.

```
          ┌──────────────────────┐
          │   Incoming Message   │
          │   (User Query)       │
          └─────────┬────────────┘
                    │
                    ▼
          ┌──────────────────────┐
          │   AI Extraction      │
          │ (Structured Output)  │
          └─────────┬────────────┘
                    │
                    ▼
          ┌──────────────────────┐
          │ Normalize / Prepare  │
          │ Data for Evaluation  │
          └─────────┬────────────┘
                    │
                    ▼
        ┌───────────────────────────────┐
        │   Parallel AI Evaluations     │
        │                               │
        │  ┌──────────┐  ┌──────────┐   │
        │  │ Grounding│  │  Schema  │   │
        │  │   Eval   │  │   Eval   │   │
        │  └──────────┘  └──────────┘   │
        │          ┌──────────┐         │
        │          │ Routing  │         │
        │          │   Eval   │         │
        │          └──────────┘         │
        └──────────────┬────────────────┘
                       │
                       ▼
          ┌──────────────────────┐
          │ Aggregate Results    │
          │ + Pass / Fail Gate   │
          └─────────┬────────────┘
                    │
           ┌────────┴────────┐
           │                 │
           ▼                 ▼
┌──────────────────┐   ┌──────────────────────┐
│ All Checks Pass  │   │ One or More Failures │
│ (Auto Path)      │   │ (Human-in-the-Loop)  │
└─────────┬────────┘   └──────────┬───────────┘
          │                         │
          ▼                         ▼
┌──────────────────┐   ┌──────────────────────┐
│ Save to Database │   │ Human Review UI      │
│ / Downstream     │   │ (Context + Reasons)  │
└─────────┬────────┘   └──────────┬───────────┘
          │                         │
          ▼                         ▼
   ┌──────────────┐      ┌──────────────────┐
   │   Complete   │      │ Approve / Reject │
   └──────────────┘      └───────┬──────────┘
                                 │
                      ┌──────────┴──────────┐
                      │                     │
                      ▼                     ▼
             ┌──────────────────┐   ┌──────────────────┐
             │ Save to Database │   │ Terminate / Stop │
             └──────────────────┘   └──────────────────┘

```

## Why this matters for customers
* **Complex logic, simple visibility:** Even with parallel agents, decision gates, and human-in-the-loop steps, the Conductor UI makes it easy to see exactly what happened and where something failed.
* **Easy to evolve:** New checks, agents, or approval steps can be added without rewriting the whole workflow.
* **Built for scale and trust:** Automation runs when it’s safe; humans step in only when needed.
* **No code spelunking required:** Teams don’t have to dig through hundreds or thousands of code files to understand or change behavior. The entire workflow (including parallel logic, decision points, and human approvals) is visible and editable in one place through the Conductor UI, making complex systems easy to reason about and evolve.

**In short, Orkes Conductor lets teams build and operate sophisticated workflows with confidence, while giving them a clear, visual way to spot issues and adapt as workflows grow and change.**

## Why This Agent Setup Exists
This demo shows how we turn a messy customer message into something you can safely automate.

First, an AI agent takes an unstructured message and turns it into more structured data. That makes the data easy to route and use, but we don’t assume it’s perfect. Models can guess, make things up, or choose the wrong category.

So right after extraction, we run a few evaluation agents in parallel. One checks that the model didn’t invent details. Another makes sure the output matches the expected schema. A third does a quick sanity check to see if the routing and urgency actually make sense based on the message.

If all the checks pass, the workflow continues automatically. If anything fails, it’s sent to a human with clear reasons why. Orkes Conductor ties this all together and makes every step visible, so you can trust what’s automated and quickly spot what needs attention.

## Agent overview/breakdown (LangChain agents)
### 1. Extraction Agent

file: `langchainAgent.js`

This agent takes a messy, unstructured customer message (like an email or chat) and turns it into a clean, structured support ticket JSON. It uses an AI model to understand the text and fill in a fixed schema, so the output is always predictable and easy to use in workflows. If information isn’t explicitly mentioned, the agent leaves it as null or uses safe defaults instead of guessing.

The agent extracts customer details, identifies the issue category and urgency, pulls out useful entities like dates, amounts, and reference IDs, and adds a short human-readable summary. The result is a single structured object that can be passed directly into routing, evaluation, or automation steps in an Orkes Conductor workflow.

#### Example input (what the agent receives):
```text
“Hi, I’m Jane Doe. I was charged $49.99 on 12/01/2025 for invoice ABC123. This is urgent—please call me.”
```

#### Example output (what the agent returns):
```json
Extraction Result:
{
  "customer": {
    "name": "Jane Doe",
    "email": null,
    "phone": null
  },
  "issue": {
    "category": "billing",
    "urgency": "high",
    "summary": "Charge of $4109.90 for invoice ABC123 on 12/01/2025."
  },
  "entities": {
    "dates": [
      "12/01/2025"
    ],
    "amounts": [
      "$4109.90"
    ],
    "reference_ids": [
      "ABC123"
    ]
  },
  "flags": {
    "requires_callback": true,
    "mentions_attachment": false
  },
  "meta": {
    "extracted_at": "2026-01-14T22:42:28.981Z"
  }
}
```

### 2. Grounding Evaluation Agent

This is an evaluation agent that checks grounding (aka “did we make stuff up?”). It takes the original customer message and the extracted ticket JSON, then verifies that key fields (email, phone, dates, amounts, reference IDs) actually appear in the original text. If the ticket includes values that aren’t supported by the message, it flags them as hallucinations and fails the eval. Names are treated as a warning instead of a hard fail, since names are harder to reliably match with simple substring rules.

#### Example input
```json
{
  "messageText": "Hi, I'm Jane Doe. I was charged $49.99 on 12/01/2025 for invoice ABC123.",
  "ticketJson": {
    "customer": { "name": "Jane Doe", "email": null, "phone": null },
    "issue": { "category": "billing", "urgency": "high", "summary": "Charged for invoice." },
    "entities": { "dates": ["12/01/2025"], "amounts": ["$49.99"], "reference_ids": ["ABC123"] },
    "flags": { "requires_callback": false, "mentions_attachment": false },
    "meta": { "extracted_at": "2026-01-14T22:10:31.150Z" }
  }
}
```

#### Output
```json
{
  "evaluator": "grounding",
  "passed": true,
  "score": 1,
  "errors": [],
  "hallucinations": [],
  "field_checks": [
    { "field": "entities.amounts[]", "value": "$49.99", "supported": true, "evidence": "$49.99", "severity": "error" },
    { "field": "entities.dates[]", "value": "12/01/2025", "supported": true, "evidence": "12/01/2025", "severity": "error" },
    { "field": "entities.reference_ids[]", "value": "ABC123", "supported": true, "evidence": "ABC123", "severity": "error" },
    { "field": "customer.name", "value": "Jane Doe", "supported": true, "evidence": "Jane Doe", "severity": "warning" }
  ]
}

```

### 3. Routing Evaluation Agent
This is an evaluation agent that checks routing sanity (aka “will this ticket get sent to the right team with the right priority?”). It takes the original customer message and the extracted ticket JSON, then uses a lightweight set of keyword-based expectations to validate that the category, urgency, and routing flags chosen by the extractor are reasonable.

The agent looks for clear signals in the customer message—such as billing-related terms, technical error keywords, urgency phrases, or requests for callbacks—and compares those signals against what the extractor produced. When the message strongly implies a specific routing decision and the extracted ticket disagrees, the agent flags a mismatch.

This agent is intentionally conservative: it only flags issues when there are strong, obvious signals in the text. It does not attempt deep semantic understanding, and it does not fail the eval when the message is ambiguous.

#### What it checks 
* Category sanity
    * Billing keywords (e.g. invoice, refund, charge) → category should be "billing"
    * Technical keywords (e.g. login, error, 2FA, crash) → category should be "technical"
    * Account keywords (e.g. subscription, plan, settings) → category should be "account"
* Urgency sanity
    * High-urgency keywords (e.g. urgent, ASAP, today) → urgency should be "high"
    * Low-urgency keywords (e.g. no rush, whenever) → urgency should be "low"
* Routing flags
    * Callback phrases (e.g. call me, phone me) → requires_callback = true
    * Attachment mentions (e.g. attached, attachment) → mentions_attachment = true

Each violated expectation is recorded as a mismatch. The score decreases slightly for each mismatch, and the eval fails if any mismatches are present.

#### Input 

```json 
{
  "messageText": "Hi, I can’t log in. I keep getting a 2FA error and it’s urgent. Please call me back today.",
  "ticketJson": {
    "customer": { "name": null, "email": null, "phone": null },
    "issue": { "category": "general", "urgency": "medium", "summary": "User needs help." },
    "entities": { "dates": [], "amounts": [], "reference_ids": [] },
    "flags": { "requires_callback": false, "mentions_attachment": false },
    "meta": { "extracted_at": "2026-01-14T22:10:31.150Z" }
  }
}
```

#### Output 

```json 
{
  "evaluator": "routing",
  "passed": false,
  "score": 0.55,
  "errors": [],
  "mismatches": [
    {
      "rule": "technical_keywords_imply_technical",
      "expected": "technical",
      "got": "general"
    },
    {
      "rule": "urgent_keywords_imply_high",
      "expected": "high",
      "got": "medium"
    },
    {
      "rule": "callback_keywords_imply_requires_callback",
      "expected": true,
      "got": false
    }
  ]
}
```

### 4. Quality Evaluation Agent

This evaluation agent checks whether the extracted ticket is useful and reasonable. It looks at the original customer message and the extracted ticket JSON, then judges whether the summary is specific, the category and urgency make sense, and obvious details from the message weren’t missed. This isn’t a strict “truth check” like grounding. It’s more of a “would a support team actually want this ticket?” check.

The quality eval protects the overall agent from producing “technically correct but useless” output, and it gives Conductor a smart reason to stop automation before bad data flows downstream. Like is this actually useful to act on? 

## How this works together
All evaluation agents run in parallel, which keeps the workflow fast while still enforcing quality. Their results are aggregated into a single decision that determines whether the workflow can proceed automatically or needs human review.

This pattern shows how Orkes Conductor makes it easy to:
1. Orchestrate multiple LangChain agents
2. Add quality gates without slowing down the system
3. Clearly see which agent passed or failed in the UI
4. Extend the workflow as new agents or checks are needed

## Test With 

### To Pass Evals

```
Hi, my name is Sarah Jade. You can reach me at sarah.j@example.com or 555-123-4567.I have a billing issue: I was charged $299.99 on my invoice #INV-123456 on 12/01/2025 and I need a refund ASAP.Please call me today if possible. I’ve attached a screenshot of the invoice.Thanks!
```

### To Fail Evals

```
Hello,I think there might be an issue with my account or billing.I was charged recently and I’m not sure why.My name is Sarah Jade.You can email me at sarah.j@example.com.Please help when you get a chance.
```

## Steps 

### Set up OPENAI_API_KEY

```bash
export OPENAI_API_KEY=your-key
```
### Add access keys 
Add your keys in the .env files :P

```bash

```

### Install dependencies
```bash
npm install
```



