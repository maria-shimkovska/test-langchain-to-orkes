import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

import { orkesConductorClient, MetadataClient } from "@io-orkes/conductor-javascript";

// Load environment variables from .env file
dotenv.config();

// Load environment variables from .env file
const REQUIRED_ENV = ["CONDUCTOR_SERVER_URL", "CONDUCTOR_KEY_ID", "CONDUCTOR_KEY_SECRET"];

// Defaults for auto-created TaskDefs (when SIMPLE tasks are discovered)
const DEFAULT_TASKDEF = {
  retryCount: 3,
  timeoutSeconds: 300,
  timeoutPolicy: "ALERT_ONLY",
};

// Ensure all required env vars are set
function requireEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}\nFix: copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// Main script
function parseArgs(argv) {
  // Usage:
  //   node scripts/register-workflows.mjs [--plan] [--no-overwrite] [--workflows-dir ./workflows]
  const args = {
    plan: false,
    overwrite: true,
    workflowsDir: "./workflows",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan" || a === "--dry-run") args.plan = true;
    else if (a === "--no-overwrite") args.overwrite = false;
    else if (a === "--workflows-dir") args.workflowsDir = argv[++i] ?? args.workflowsDir;
  }
  return args;
}

// Read all JSON files from a directory and parse them as workflow definitions
async function readWorkflowJsonFiles(dir) {
  const abs = path.resolve(dir);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => path.join(abs, e.name))
    .sort();

  if (!files.length) throw new Error(`No workflow JSON files found in ${abs}`);

  const workflows = [];
  for (const file of files) {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    workflows.push({ file, wf: sanitizeWorkflowDef(parsed) });
  }
  return workflows;
}

// Basic validation and cleanup of a workflow definition object
function sanitizeWorkflowDef(wf) {
  // Remove common export noise; keep definition
  const { createTime, updateTime, ...rest } = wf;

  if (!rest?.name || typeof rest.name !== "string") throw new Error("Workflow missing 'name'");
  if (typeof rest?.version !== "number") throw new Error("Workflow missing numeric 'version'");
  if (!Array.isArray(rest?.tasks)) throw new Error("Workflow missing 'tasks' array");

  return rest;
}

// Extract unique SIMPLE task names from a list of workflow definitions
function extractSimpleTaskNames(workflows) {
  const names = new Set();

  for (const { wf } of workflows) {
    for (const t of wf.tasks ?? []) {
      if (t?.type === "SIMPLE" && typeof t?.name === "string" && t.name.trim()) {
        names.add(t.name.trim());
      }
    }
  }

  return [...names].sort();
}

// Check if an error indicates that a resource already exists
function isConflictAlreadyExists(err) {
  // Different SDK/server responses vary; this catches common cases.
  const status = err?.status || err?.response?.status || err?.statusCode;
  const msg = String(err?.message || "").toLowerCase();

  // 409 is common for "already exists". Some servers return 400 with message.
  return status === 409 || msg.includes("already exists") || msg.includes("duplicate");
}

// Ensure a TaskDef exists for a given SIMPLE task name; create if missing
async function ensureTaskDef(metadata, taskName, plan) {
  // Build taskdef from defaults (+ optional overrides)
  const taskDef = {
    name: taskName,
    ...DEFAULT_TASKDEF,
    // ...(TASKDEF_OVERRIDES?.[taskName] ?? {}),
  };

  if (plan) return { taskName, action: "would-register" };

  try {
    // Many environments treat this as upsert; if not, we catch conflict and treat as OK.
    await metadata.registerTask(taskDef);
    return { taskName, action: "registered" };
  } catch (err) {
    if (isConflictAlreadyExists(err)) {
      return { taskName, action: "already-exists" };
    }
    throw err;
  }
}

// Main entry point for script execution 
async function main() {
  requireEnv();
  const { plan, overwrite, workflowsDir } = parseArgs(process.argv.slice(2));

  const client = await orkesConductorClient({
    serverUrl: process.env.CONDUCTOR_SERVER_URL,
    keyId: process.env.CONDUCTOR_KEY_ID,
    keySecret: process.env.CONDUCTOR_KEY_SECRET,
  });

  const metadata = new MetadataClient(client);

  const workflows = await readWorkflowJsonFiles(workflowsDir);
  const simpleTaskNames = extractSimpleTaskNames(workflows);

  console.log(`Mode: ${plan ? "PLAN (no changes)" : "APPLY"}`);
  console.log(`Overwrite workflows: ${overwrite ? "YES" : "NO"}`);
  console.log(`Workflows dir: ${workflowsDir}\n`);

  // 1) Ensure SIMPLE task defs exist
  console.log(`SIMPLE task types discovered (${simpleTaskNames.length}):`);
  if (!simpleTaskNames.length) console.log("  (none)");
  for (const n of simpleTaskNames) console.log(`  - ${n}`);
  console.log("");

  const taskResults = [];
  for (const taskName of simpleTaskNames) {
    process.stdout.write(`→ taskdef ${taskName} ... `);
    const r = await ensureTaskDef(metadata, taskName, plan);
    console.log(r.action);
    taskResults.push(r);
  }

  console.log("");

  // 2) Register workflows
  console.log(`Workflow definitions (${workflows.length})`);
  for (const { file, wf } of workflows) {
    const id = `${wf.name}:${wf.version}`;
    if (plan) {
      console.log(`→ would register workflow ${id} (${path.basename(file)}) overwrite=${overwrite}`);
    } else {
      process.stdout.write(`→ workflow ${id} (${path.basename(file)}) ... `);
      await metadata.registerWorkflowDef(wf, overwrite);
      console.log("OK");
    }
  }

  // Summary
  const counts = taskResults.reduce(
    (acc, r) => ((acc[r.action] = (acc[r.action] ?? 0) + 1), acc),
    {}
  );

  console.log("\nSummary");
  console.log(`- Task defs: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
  console.log(`- Workflows: ${plan ? `${workflows.length} would register` : `${workflows.length} registered`}`);
  console.log("\nDone.");
}

// Run the main function and handle errors
main().catch((err) => {
  console.error("\nRegister failed:");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});