import fs from "fs";
import path from "path";

const KNOWLEDGE_ROOT = path.join(__dirname, "../../knowledge");

interface SkillEntry {
  id: string;
  file: string;
  topic: string;
  examples?: string;
}

const SKILL_MANIFEST: SkillEntry[] = [
  { id: "00", file: "skills/00-identity.md", topic: "Persona, tone, Slack formatting rules" },
  { id: "01", file: "skills/01-salesforce-metadata.md", topic: "SOQL patterns, Tooling API, metadata queries, SOQL vs Tooling API cheat sheet" },
  { id: "02", file: "skills/02-flow-building.md", topic: "Flows, flow automation, Flow types", examples: "examples/flows/" },
  { id: "03", file: "skills/03-apex-development.md", topic: "Apex code, triggers, test classes, governor limits", examples: "examples/apex/" },
  { id: "04", file: "skills/04-report-building.md", topic: "Reports, dashboards", examples: "examples/reports/" },
  { id: "05", file: "skills/05-permissions.md", topic: "Permissions, profiles, sharing rules, access control, roles" },
  { id: "06", file: "skills/06-git-workflow.md", topic: "Git, source control, branching" },
  { id: "07", file: "skills/07-deployment.md", topic: "Deployment, releases, change sets" },
  { id: "08", file: "skills/08-integrations.md", topic: "External integrations, APIs, webhooks" },
];

const ALWAYS_LOADED_IDS = ["00", "01"];

export function getManifest(): SkillEntry[] {
  return SKILL_MANIFEST;
}

function readFileFromKnowledge(relativePath: string): string {
  const fullPath = path.join(KNOWLEDGE_ROOT, relativePath);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch (err) {
    console.error(`KNOWLEDGE FILE READ ERROR: ${fullPath} — ${err instanceof Error ? err.message : String(err)}`);
    return "";
  }
}

function loadExamplesFromDir(dirPath: string): string {
  const fullDir = path.join(KNOWLEDGE_ROOT, dirPath);
  try {
    const files = fs.readdirSync(fullDir).filter((f) => !f.startsWith("."));
    if (files.length === 0) return "";

    const parts: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(fullDir, file), "utf-8");
      if (content.trim()) {
        parts.push(`### Example: ${file}\n\`\`\`\n${content.trim()}\n\`\`\``);
      }
    }
    return parts.join("\n\n");
  } catch (err) {
    console.error(`KNOWLEDGE EXAMPLES DIR ERROR: ${fullDir} — ${err instanceof Error ? err.message : String(err)}`);
    return "";
  }
}

export function loadKnowledge(classifiedIds: string[]): string {
  console.log(`\n=== KNOWLEDGE LOADER START ===`);

  // Merge always-loaded IDs with classified IDs (deduplicated)
  const allIds = [...new Set([...ALWAYS_LOADED_IDS, ...classifiedIds])];

  const alwaysFileNames = ALWAYS_LOADED_IDS.map((id) => {
    const entry = SKILL_MANIFEST.find((s) => s.id === id);
    return entry ? path.basename(entry.file) : id;
  });
  console.log(`LOADING ALWAYS FILES: ${alwaysFileNames.join(", ")}`);

  const classifiedFileNames = classifiedIds.map((id) => {
    const entry = SKILL_MANIFEST.find((s) => s.id === id);
    return entry ? path.basename(entry.file) : id;
  });
  if (classifiedFileNames.length > 0) {
    console.log(`LOADING CLASSIFIED FILES: ${classifiedFileNames.join(", ")}`);
  } else {
    console.log(`NO ADDITIONAL CLASSIFIED FILES — USING ONLY ALWAYS-LOADED`);
  }

  const parts: string[] = [];

  for (const id of allIds) {
    const entry = SKILL_MANIFEST.find((s) => s.id === id);
    if (!entry) {
      console.warn(`UNKNOWN SKILL ID: ${id} — SKIPPING`);
      continue;
    }

    const content = readFileFromKnowledge(entry.file);
    if (content) {
      parts.push(content);
    }

    // Load examples if this skill has an examples directory
    if (entry.examples) {
      const examples = loadExamplesFromDir(entry.examples);
      if (examples) {
        parts.push(examples);
      }
    }
  }

  const combined = parts.join("\n\n---\n\n");
  console.log(`TOTAL KNOWLEDGE: ${allIds.length} files, ${combined.length} chars`);
  console.log(`=== KNOWLEDGE LOADER END ===\n`);

  return combined;
}
