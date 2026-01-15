import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

import { orkesConductorClient, MetadataClient, TemplateClient } from "@io-orkes/conductor-javascript";

// Load environment variables from .env file
dotenv.config();
const REQUIRED_ENV = ["CONDUCTOR_SERVER_URL", "CONDUCTOR_KEY_ID", "CONDUCTOR_KEY_SECRET"];

// Defaults for auto-created TaskDefs (when SIMPLE tasks are discovered)
const DEFAULT_TASKDEF = {
  retryCount: 3,
  timeoutSeconds: 4000,
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
  //   node scripts/register-workflows.mjs [--plan] [--no-overwrite] [--workflows-dir ./workflows] [file.json]
  const args = {
    plan: false,
    overwrite: true,
    workflowsDir: "./workflows",
    workflowFile: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--plan" || a === "--dry-run") {
      args.plan = true;
    } else if (a === "--no-overwrite") {
      args.overwrite = false;
    } else if (a === "--workflows-dir") {
      args.workflowsDir = argv[++i] ?? args.workflowsDir;
    } else if (!a.startsWith("-") && a.toLowerCase().endsWith(".json")) {
      // positional workflow file
      args.workflowFile = a;
    }
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

async function readSingleWorkflowFile(filePath) {
  const abs = path.resolve(filePath);

  const raw = await fs.readFile(abs, "utf-8");
  const parsed = JSON.parse(raw);

  return [{ file: abs, wf: sanitizeWorkflowDef(parsed) }];
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

// Generator to walk all tasks in a workflow, including nested tasks
function* walkTasks(taskList = []) {
  for (const t of taskList) {
    if (!t) continue;
    yield t;

    // SWITCH / DECISION cases: { "HUMAN": [...], "AUTO": [...] }
    if (t.decisionCases && typeof t.decisionCases === "object") {
      for (const caseTasks of Object.values(t.decisionCases)) {
        if (Array.isArray(caseTasks)) yield* walkTasks(caseTasks);
      }
    }

    // defaultCase: [...]
    if (Array.isArray(t.defaultCase)) {
      yield* walkTasks(t.defaultCase);
    }

    // FORK_JOIN forkTasks: [ [branch1Tasks...], [branch2Tasks...], ... ]
    if (Array.isArray(t.forkTasks)) {
      for (const branch of t.forkTasks) {
        yield* walkTasks(branch);
      }
    }
  }
}

// Extract all unique SIMPLE task names from a set of workflows
function extractSimpleTaskNames(workflows) {
  const names = new Set();

  for (const { wf } of workflows) {
    for (const t of walkTasks(wf.tasks)) {
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

// Extract all unique HUMAN task form templates from a set of workflows
function extractHumanFormTemplates(workflows) {
  const templates = new Map(); // key "name:version" -> {name, version}

  for (const { wf } of workflows) {
    for (const t of walkTasks(wf.tasks)) {
      if (t?.type !== "HUMAN") continue;

      const tpl = t?.inputParameters?.__humanTaskDefinition?.userFormTemplate;
      if (tpl?.name && typeof tpl.version === "number") {
        templates.set(`${tpl.name}:${tpl.version}`, { name: tpl.name, version: tpl.version });
      }
    }
  }

  return [...templates.values()];
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

// Read and parse all JSON files from a directory
async function readJsonFiles(dir) {
  const abs = path.resolve(dir);
  let entries = [];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => path.join(abs, e.name))
    .sort();

  const items = [];
  for (const file of files) {
    const raw = await fs.readFile(file, "utf-8");
    items.push({ file, json: JSON.parse(raw) });
  }
  return items;
}

// Main entry point for script execution 
async function main() {
  requireEnv();
  const { plan, overwrite, workflowsDir, workflowFile } = parseArgs(process.argv.slice(2));

  const client = await orkesConductorClient({
    serverUrl: process.env.CONDUCTOR_SERVER_URL,
    keyId: process.env.CONDUCTOR_KEY_ID,
    keySecret: process.env.CONDUCTOR_KEY_SECRET,
  });

  const metadata = new MetadataClient(client);
  const templateClient = new TemplateClient(client);

  let workflows;
  if (workflowFile) {
    workflows = await readSingleWorkflowFile(workflowFile);
  } else {
    workflows = await readWorkflowJsonFiles(workflowsDir);
  }

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

// 1.5) Register ONLY required form templates referenced by HUMAN tasks
const formsDir = "./forms";
const requiredTemplates = extractHumanFormTemplates(workflows);
const forms = await readJsonFiles(formsDir);

// Build a lookup: "name:version" -> {file, json}
const formsByKey = new Map();
for (const { file, json } of forms) {
  if (json?.name && typeof json?.version === "number") {
    formsByKey.set(`${json.name}:${json.version}`, { file, json });
  }
}

if (requiredTemplates.length) {
  console.log(`Human form templates required (${requiredTemplates.length}):`);
  for (const t of requiredTemplates) console.log(`  - ${t.name}:${t.version}`);
  console.log("");

  for (const t of requiredTemplates) {
    const key = `${t.name}:${t.version}`;
    const local = formsByKey.get(key);

    if (!local) {
      throw new Error(
        `Missing form template ${key}. Add a JSON file in ${formsDir} with { "name": "${t.name}", "version": ${t.version}, ... }`
      );
    }

    if (plan) {
      console.log(`→ would register form template ${key} (${path.basename(local.file)})`);
    } else {
      process.stdout.write(`→ form template ${key} (${path.basename(local.file)}) ... `);
      try {
        await templateClient.registerTemplate(local.json);
        console.log("OK");
      } catch (err) {
        if (isConflictAlreadyExists(err)) {
          console.log("already-exists");
        } else {
          throw err;
        }
      }
    }
  }

  console.log("");
} else {
  console.log("No HUMAN task form templates referenced (skipping forms).");
  console.log("");
}

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