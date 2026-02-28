import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const CLASSIFIER_SYSTEM = `You classify Salesforce questions. Given a user message, return a JSON array of skill IDs that are relevant.

Available skills:
- "02" — Flows, flow automation, workflow rules
- "03" — Apex code, triggers, test classes, development
- "04" — Reports, dashboards, analytics
- "05" — Permissions, profiles, sharing rules, access control
- "06" — Git, source control
- "07" — Deployment, releases
- "08" — Integrations, external APIs

Rules:
- Return ONLY a JSON array, e.g. ["03", "05"]
- Pick 1-3 most relevant skills. Don't over-select.
- If the question is a general data query (e.g. "how many contacts"), return an empty array [].
- Skills 00 and 01 are always loaded — do not include them.

Return ONLY the JSON array.`;

export async function classifyMessage(messageText: string): Promise<string[]> {
  console.log(`\n=== KNOWLEDGE CLASSIFIER START ===`);
  console.log(`USER MESSAGE: "${messageText.slice(0, 200)}"`);

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: "user", content: messageText }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );

    if (!textBlock) {
      console.warn(`CLASSIFIER RETURNED NO TEXT BLOCK — FALLING BACK TO []`);
      console.log(`=== KNOWLEDGE CLASSIFIER END (no text) ===\n`);
      return [];
    }

    const raw = textBlock.text.trim();
    console.log(`HAIKU CLASSIFIER RESPONSE: ${raw}`);

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      console.warn(`CLASSIFIER RESPONSE IS NOT AN ARRAY — FALLING BACK TO []`);
      console.log(`=== KNOWLEDGE CLASSIFIER END (bad format) ===\n`);
      return [];
    }

    // Validate each ID is a known skill ID (02-08)
    const validIds = ["02", "03", "04", "05", "06", "07", "08"];
    const filtered = parsed.filter((id: unknown) => typeof id === "string" && validIds.includes(id));

    if (filtered.length !== parsed.length) {
      console.warn(`CLASSIFIER RETURNED SOME INVALID IDS — FILTERED: [${filtered.join(", ")}] FROM [${parsed.join(", ")}]`);
    }

    console.log(`CLASSIFIER RESULT: [${filtered.join(", ")}]`);
    console.log(`=== KNOWLEDGE CLASSIFIER END (success) ===\n`);
    return filtered;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`CLASSIFIER ERROR: ${message} — FALLING BACK TO []`);
    console.log(`=== KNOWLEDGE CLASSIFIER END (error) ===\n`);
    return [];
  }
}
