## create all workflows with one command 

```bash
npm run register-workflows
```

This will register both workflow JSON files to your Conductor Developer Edition account

## Prereqs 
* Node.js 18+
* An Orkes access key (Key ID + Secret) with permission to use the Metadata APIs (to create/update workflow defs). 

## What this does
No more going by hand to recreate workflows in the UI 

### Auto-registers any SIMPLE task types referenced by your workflow JSONs
### Register the workflows

How someone runs it
cp .env.example .env
# fill in values

```bash
npm i
npm run register-workflows
```

Optional dry run:

```bash
npm run plan:register-workflows
```

run a specific file
```bash
npm run register-workflows -- workflows/my-workflow.json
```

plan mode: 

```bash
npm run register-workflows -- workflows/my-workflow.json --plan
```