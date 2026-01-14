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

## Agent overview (LangChain agents)
### 1. Extraction Agent

This agent takes an unstructured message (for example, an email or support ticket) and extracts structured information from it. Its job is to turn free-form text into clean, machine-readable data that downstream systems can reliably use.

### 2. Grounding Evaluation Agent

This agent checks whether the extracted data is actually grounded in the original message. It verifies that the AI didn’t hallucinate or invent information that wasn’t present in the input.

### 3. Schema Evaluation Agent

This agent validates that the extracted data matches the expected structure and format. It ensures required fields are present, values are valid, and the output conforms to the schema needed by downstream systems.

### 4. Routing Evaluation Agent
This agent checks whether the extracted data would be routed correctly. For example, it validates that the right category, priority, or destination was chosen based on the original message.

## How this works together
All evaluation agents run in parallel, which keeps the workflow fast while still enforcing quality. Their results are aggregated into a single decision that determines whether the workflow can proceed automatically or needs human review.
This pattern shows how Orkes Conductor makes it easy to:
Orchestrate multiple LangChain agents
Add quality gates without slowing down the system
Clearly see which agent passed or failed in the UI
Extend the workflow as new agents or checks are needed


