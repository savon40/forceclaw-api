import type Anthropic from "@anthropic-ai/sdk";
import { Connection } from "jsforce";
import { OrgContextService } from "../services/orgContext";
import { ComponentCacheService } from "../services/componentCache";

// Tool mode: 'all' = available in every org, 'development' = sandbox/dev only
const toolModes = new Map<string, "all" | "development">([
  ["query_salesforce", "all"],
  ["describe_object", "all"],
  ["list_objects", "all"],
  ["list_flows", "all"],
  ["list_apex_classes", "all"],
  ["get_apex_class_body", "development"],
  ["get_apex_trigger_body", "development"],
  ["get_flow_definition", "development"],
  ["list_lwc_bundles", "all"],
  ["get_lwc_source", "development"],
  ["run_apex_tests", "development"],
  ["get_code_coverage", "development"],
  ["create_apex_class", "development"],
  ["update_apex_class", "development"],
  ["create_apex_trigger", "development"],
  ["update_apex_trigger", "development"],
]);

/**
 * Return the tool definitions filtered by org type.
 * Production orgs get only 'all' tools (query, describe, list inventory).
 * Dev/sandbox orgs get every tool.
 */
export function getToolsForOrg(orgType: string): Anthropic.Tool[] {
  const isProduction = orgType === "production";
  if (!isProduction) {
    console.log(`TOOL FILTER: orgType=${orgType} — SENDING ALL ${toolDefinitions.length} TOOLS`);
    return toolDefinitions;
  }

  const filtered = toolDefinitions.filter((t) => toolModes.get(t.name) === "all");
  console.log(`TOOL FILTER: orgType=${orgType} — SENDING ${filtered.length}/${toolDefinitions.length} TOOLS (production mode)`);
  return filtered;
}

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "query_salesforce",
    description:
      "Execute a SOQL query against the Salesforce org. SELECT queries only. A LIMIT clause will be auto-appended if missing (default 200). Returns up to 50 records for display; use COUNT() for totals.",
    input_schema: {
      type: "object" as const,
      properties: {
        soql: {
          type: "string",
          description: "The SOQL query to execute. Must be a SELECT statement.",
        },
      },
      required: ["soql"],
    },
  },
  {
    name: "describe_object",
    description:
      "Get the full field and relationship description of a Salesforce sObject. Returns field names, types, labels, picklist values, and relationship info.",
    input_schema: {
      type: "object" as const,
      properties: {
        object_name: {
          type: "string",
          description: "The API name of the sObject (e.g. 'Account', 'Custom_Object__c').",
        },
      },
      required: ["object_name"],
    },
  },
  {
    name: "list_objects",
    description:
      "List all queryable sObjects in the org. Returns both standard and custom objects with labels.",
    input_schema: {
      type: "object" as const,
      properties: {
        custom_only: {
          type: "boolean",
          description: "If true, only return custom objects. Default false.",
        },
      },
      required: [],
    },
  },
  {
    name: "list_flows",
    description:
      "List all active Flows in the org, grouped by process type (Record-Triggered, Screen Flow, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_apex_classes",
    description:
      "List all custom Apex classes in the org (excluding managed packages).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // Phase 2A — Deep Read tools
  {
    name: "get_apex_class_body",
    description:
      "Get the full source code of an Apex class by name. Returns the complete class body.",
    input_schema: {
      type: "object" as const,
      properties: {
        class_name: {
          type: "string",
          description: "The name of the Apex class (e.g. 'AccountTriggerHandler').",
        },
      },
      required: ["class_name"],
    },
  },
  {
    name: "get_apex_trigger_body",
    description:
      "Get the full source code of an Apex trigger by name. Returns the complete trigger body and the sObject it's on.",
    input_schema: {
      type: "object" as const,
      properties: {
        trigger_name: {
          type: "string",
          description: "The name of the Apex trigger (e.g. 'AccountTrigger').",
        },
      },
      required: ["trigger_name"],
    },
  },
  {
    name: "get_flow_definition",
    description:
      "Get the full definition/metadata of a Flow by API name. Returns the flow structure including elements, decisions, actions, and assignments.",
    input_schema: {
      type: "object" as const,
      properties: {
        flow_api_name: {
          type: "string",
          description: "The API/Developer name of the Flow (e.g. 'Update_Account_Status').",
        },
      },
      required: ["flow_api_name"],
    },
  },

  // LWC Read tools
  {
    name: "list_lwc_bundles",
    description:
      "List all custom Lightning Web Components in the org (excluding managed packages). Returns developer name, label, API version, and description.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_lwc_source",
    description:
      "Get the full source code of a Lightning Web Component by developer name. Returns all files in the bundle (JS, HTML, CSS, XML config).",
    input_schema: {
      type: "object" as const,
      properties: {
        developer_name: {
          type: "string",
          description: "The developer name of the LWC (e.g. 'myComponent'). Use list_lwc_bundles to find available names.",
        },
      },
      required: ["developer_name"],
    },
  },

  // Apex Test tools
  {
    name: "run_apex_tests",
    description:
      "Run one or more Apex test classes synchronously. Returns pass/fail per test method, error messages for failures, and code coverage for the classes under test. May take up to a few minutes for large test classes.",
    input_schema: {
      type: "object" as const,
      properties: {
        test_class_names: {
          type: "array",
          items: { type: "string" },
          description: "Array of test class names to run (e.g. ['AccountTriggerTest', 'OpportunityServiceTest']).",
        },
      },
      required: ["test_class_names"],
    },
  },
  {
    name: "get_code_coverage",
    description:
      "Get the current code coverage percentage for a specific Apex class or trigger, based on the most recent test run. Does NOT re-run tests — use run_apex_tests to get fresh coverage.",
    input_schema: {
      type: "object" as const,
      properties: {
        class_name: {
          type: "string",
          description: "The name of the Apex class or trigger to check coverage for.",
        },
      },
      required: ["class_name"],
    },
  },

  // Phase 2B — Write tools
  {
    name: "create_apex_class",
    description:
      "Create a new Apex class in the org via the Tooling API. Only available in sandbox/developer orgs. Returns the new class ID or compile errors.",
    input_schema: {
      type: "object" as const,
      properties: {
        class_name: {
          type: "string",
          description: "The name for the new Apex class.",
        },
        body: {
          type: "string",
          description: "The full Apex class source code (must include the class declaration).",
        },
      },
      required: ["class_name", "body"],
    },
  },
  {
    name: "update_apex_class",
    description:
      "Update an existing Apex class body in the org via the Tooling API. Only available in sandbox/developer orgs. Looks up the class by name, then replaces the body. Returns success or compile errors.",
    input_schema: {
      type: "object" as const,
      properties: {
        class_name: {
          type: "string",
          description: "The name of the existing Apex class to update.",
        },
        body: {
          type: "string",
          description: "The new full Apex class source code.",
        },
      },
      required: ["class_name", "body"],
    },
  },
  {
    name: "create_apex_trigger",
    description:
      "Create a new Apex trigger in the org via the Tooling API. Only available in sandbox/developer orgs. Returns the new trigger ID or compile errors.",
    input_schema: {
      type: "object" as const,
      properties: {
        trigger_name: {
          type: "string",
          description: "The name for the new trigger.",
        },
        sobject_name: {
          type: "string",
          description: "The sObject API name the trigger fires on (e.g. 'Account', 'Custom__c').",
        },
        body: {
          type: "string",
          description: "The full Apex trigger source code (must include the trigger declaration).",
        },
      },
      required: ["trigger_name", "sobject_name", "body"],
    },
  },
  {
    name: "update_apex_trigger",
    description:
      "Update an existing Apex trigger body in the org via the Tooling API. Only available in sandbox/developer orgs. Looks up the trigger by name, then replaces the body. Returns success or compile errors.",
    input_schema: {
      type: "object" as const,
      properties: {
        trigger_name: {
          type: "string",
          description: "The name of the existing Apex trigger to update.",
        },
        body: {
          type: "string",
          description: "The new full Apex trigger source code.",
        },
      },
      required: ["trigger_name", "body"],
    },
  },
];

interface ToolResult {
  content: string;
  isError: boolean;
}

/**
 * Assert that the org is writable (sandbox or developer). Throws for production orgs.
 */
function assertWritableOrg(orgType: string): void {
  if (orgType === "production") {
    throw new Error(
      "WRITE BLOCKED: This is a production org. Apex class and trigger writes are only allowed in sandbox or developer orgs. " +
      "Please connect a sandbox org to make changes."
    );
  }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  orgContext: OrgContextService,
  conn: Connection,
  componentCache: ComponentCacheService | null,
  orgType: string
): Promise<ToolResult> {
  console.log(`=== TOOL EXECUTION: ${name} ===`);
  console.log(`TOOL INPUT: ${JSON.stringify(input)}`);

  // Safety guard: if a dev-only tool is called but componentCache is null (production),
  // reject it. This shouldn't happen because tools are filtered, but just in case.
  const mode = toolModes.get(name);
  if (mode === "development" && !componentCache) {
    console.error(`TOOL BLOCKED: ${name} is a development-only tool but componentCache is null (production org)`);
    return {
      content: `This tool is not available for production orgs. Only data query and inventory tools are available.`,
      isError: true,
    };
  }

  try {
    switch (name) {
      // Phase 1 — read-only
      case "query_salesforce":
        return await executeQuery(input.soql as string, conn);
      case "describe_object":
        return await executeDescribe(input.object_name as string, conn);
      case "list_objects":
        return await executeListObjects(input.custom_only as boolean | undefined, orgContext);
      case "list_flows":
        return await executeListFlows(orgContext);
      case "list_apex_classes":
        return await executeListApexClasses(orgContext);

      // Phase 2A — deep read (componentCache guaranteed non-null by safety guard above)
      case "get_apex_class_body":
        return await executeGetApexClassBody(input.class_name as string, componentCache!);
      case "get_apex_trigger_body":
        return await executeGetApexTriggerBody(input.trigger_name as string, componentCache!);
      case "get_flow_definition":
        return await executeGetFlowDefinition(input.flow_api_name as string, componentCache!);

      // LWC read (componentCache guaranteed non-null by safety guard above)
      case "list_lwc_bundles":
        return await executeListLwcBundles(componentCache!);
      case "get_lwc_source":
        return await executeGetLwcSource(input.developer_name as string, componentCache!);

      // Apex tests
      case "run_apex_tests":
        return await executeRunApexTests(input.test_class_names as string[], conn);
      case "get_code_coverage":
        return await executeGetCodeCoverage(input.class_name as string, conn);

      // Phase 2B — write (componentCache guaranteed non-null by safety guard above)
      case "create_apex_class":
        return await executeCreateApexClass(
          input.class_name as string, input.body as string, conn, orgContext, componentCache!, orgType
        );
      case "update_apex_class":
        return await executeUpdateApexClass(
          input.class_name as string, input.body as string, conn, orgContext, componentCache!, orgType
        );
      case "create_apex_trigger":
        return await executeCreateApexTrigger(
          input.trigger_name as string, input.sobject_name as string, input.body as string,
          conn, orgContext, componentCache!, orgType
        );
      case "update_apex_trigger":
        return await executeUpdateApexTrigger(
          input.trigger_name as string, input.body as string, conn, orgContext, componentCache!, orgType
        );

      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`TOOL ERROR (${name}): ${message}`);
    return { content: `Error: ${message}`, isError: true };
  }
}

// ─────────────────────────────────────────
// Phase 1 handlers (unchanged)
// ─────────────────────────────────────────

async function executeQuery(soql: string, conn: Connection): Promise<ToolResult> {
  // Security: block non-SELECT queries
  const trimmed = soql.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT")) {
    return {
      content: "Only SELECT queries are allowed. INSERT, UPDATE, DELETE, and UPSERT are not supported.",
      isError: true,
    };
  }

  // Auto-append LIMIT if missing
  let query = soql.trim();
  if (!/\bLIMIT\b/i.test(query)) {
    query += " LIMIT 200";
    console.log(`AUTO-APPENDED LIMIT: ${query}`);
  }

  // Enforce max LIMIT of 2000
  const limitMatch = query.match(/\bLIMIT\s+(\d+)/i);
  if (limitMatch && parseInt(limitMatch[1], 10) > 2000) {
    query = query.replace(/\bLIMIT\s+\d+/i, "LIMIT 2000");
    console.log(`CAPPED LIMIT TO 2000: ${query}`);
  }

  console.log(`EXECUTING SOQL: ${query}`);
  const result = await conn.query<Record<string, unknown>>(query);
  console.log(`SOQL RESULT: ${result.totalSize} total records, ${result.records.length} returned`);

  // Format results
  const totalSize = result.totalSize;
  const records = result.records.slice(0, 50);

  // Clean out jsforce metadata attributes
  const cleanRecords = records.map((r: Record<string, unknown>) => {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(r)) {
      if (key === "attributes") continue;
      if (value && typeof value === "object" && "attributes" in (value as Record<string, unknown>)) {
        // Nested relationship — clean it too
        const nested: Record<string, unknown> = {};
        for (const [nk, nv] of Object.entries(value as Record<string, unknown>)) {
          if (nk === "attributes") continue;
          nested[nk] = nv;
        }
        clean[key] = nested;
      } else {
        clean[key] = value;
      }
    }
    return clean;
  });

  let output = `Total records: ${totalSize}\n`;
  if (cleanRecords.length === 0) {
    output += "No records found.";
  } else {
    output += `Showing ${cleanRecords.length}${totalSize > 50 ? ` of ${totalSize}` : ""}:\n`;
    output += JSON.stringify(cleanRecords, null, 2);
  }

  return { content: output, isError: false };
}

async function executeDescribe(objectName: string, conn: Connection): Promise<ToolResult> {
  console.log(`DESCRIBING OBJECT: ${objectName}`);
  const desc = await conn.describe(objectName);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields = (desc.fields as any[]).map((f: any) => {
    const info: Record<string, unknown> = {
      name: f.name,
      label: f.label,
      type: f.type,
      required: !f.nillable && !f.defaultedOnCreate,
    };
    if (f.referenceTo && f.referenceTo.length > 0) {
      info.referenceTo = f.referenceTo;
      info.relationshipName = f.relationshipName;
    }
    if (f.picklistValues && f.picklistValues.length > 0) {
      info.picklistValues = f.picklistValues
        .filter((p: any) => p.active)
        .map((p: any) => p.value);
    }
    if (f.length && f.type === "string") {
      info.maxLength = f.length;
    }
    return info;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const childRelationships = (desc.childRelationships as any[])
    .filter((cr: any) => cr.relationshipName)
    .slice(0, 30)
    .map((cr: any) => ({
      name: cr.relationshipName,
      childObject: cr.childSObject,
      field: cr.field,
    }));

  const output = {
    name: desc.name,
    label: desc.label,
    custom: desc.custom,
    recordCount: "Use query_salesforce with COUNT() to get record count",
    fieldCount: fields.length,
    fields,
    childRelationships,
  };

  console.log(`DESCRIBE RESULT: ${fields.length} fields, ${childRelationships.length} child relationships`);
  return { content: JSON.stringify(output, null, 2), isError: false };
}

async function executeListObjects(
  customOnly: boolean | undefined,
  orgContext: OrgContextService
): Promise<ToolResult> {
  const objects = await orgContext.getObjects();
  const filtered = customOnly ? objects.filter((o) => o.custom) : objects;

  const grouped = {
    custom: filtered.filter((o) => o.custom).map((o) => `${o.name} (${o.label})`),
    standard: customOnly ? [] : filtered.filter((o) => !o.custom).map((o) => o.name),
  };

  let output = "";
  if (grouped.custom.length > 0) {
    output += `Custom Objects (${grouped.custom.length}):\n${grouped.custom.join("\n")}\n\n`;
  }
  if (grouped.standard.length > 0) {
    output += `Standard Objects (${grouped.standard.length}):\n${grouped.standard.join(", ")}`;
  }

  return { content: output || "No objects found.", isError: false };
}

async function executeListFlows(orgContext: OrgContextService): Promise<ToolResult> {
  const flows = await orgContext.getFlows();

  if (flows.length === 0) {
    return { content: "No active flows found in this org.", isError: false };
  }

  // Group by process type
  const byType = new Map<string, typeof flows>();
  for (const f of flows) {
    const list = byType.get(f.processType) || [];
    list.push(f);
    byType.set(f.processType, list);
  }

  let output = `Active Flows (${flows.length} total):\n\n`;
  for (const [type, typeFlows] of byType) {
    output += `${type} (${typeFlows.length}):\n`;
    for (const f of typeFlows) {
      output += `  - ${f.label} (${f.name})\n`;
    }
    output += "\n";
  }

  return { content: output, isError: false };
}

async function executeListApexClasses(orgContext: OrgContextService): Promise<ToolResult> {
  const classes = await orgContext.getApexClasses();

  if (classes.length === 0) {
    return { content: "No custom Apex classes found in this org.", isError: false };
  }

  let output = `Apex Classes (${classes.length}):\n`;
  for (const c of classes) {
    output += `  - ${c.name} (${c.lengthWithoutComments} chars)\n`;
  }

  return { content: output, isError: false };
}

// ─────────────────────────────────────────
// Phase 2A — Deep Read handlers
// ─────────────────────────────────────────

async function executeGetApexClassBody(
  className: string,
  componentCache: ComponentCacheService
): Promise<ToolResult> {
  console.log(`=== GET APEX CLASS BODY: ${className} ===`);
  const data = await componentCache.getApexClassBody(className);

  const output = `Apex Class: ${data.name} (Id: ${data.id})\n\n\`\`\`apex\n${data.body}\n\`\`\``;
  console.log(`RETURNED APEX CLASS BODY: ${data.name} (${data.body.length} chars)`);
  return { content: output, isError: false };
}

async function executeGetApexTriggerBody(
  triggerName: string,
  componentCache: ComponentCacheService
): Promise<ToolResult> {
  console.log(`=== GET APEX TRIGGER BODY: ${triggerName} ===`);
  const data = await componentCache.getApexTriggerBody(triggerName);

  const output = `Apex Trigger: ${data.name} on ${data.tableEnumOrId} (Id: ${data.id})\n\n\`\`\`apex\n${data.body}\n\`\`\``;
  console.log(`RETURNED APEX TRIGGER BODY: ${data.name} (${data.body.length} chars)`);
  return { content: output, isError: false };
}

async function executeGetFlowDefinition(
  flowApiName: string,
  componentCache: ComponentCacheService
): Promise<ToolResult> {
  console.log(`=== GET FLOW DEFINITION: ${flowApiName} ===`);
  const data = await componentCache.getFlowDefinition(flowApiName);

  const output = `Flow: ${data.label} (${data.apiName})\nType: ${data.processType}\nId: ${data.id}\n\nMetadata:\n${JSON.stringify(data.metadata, null, 2)}`;
  console.log(`RETURNED FLOW DEFINITION: ${data.apiName} — ${data.processType}`);
  return { content: output, isError: false };
}

// ─────────────────────────────────────────
// LWC Read handlers
// ─────────────────────────────────────────

async function executeListLwcBundles(
  componentCache: ComponentCacheService
): Promise<ToolResult> {
  console.log(`=== LIST LWC BUNDLES ===`);
  const bundles = await componentCache.getLwcBundles();

  if (bundles.length === 0) {
    return { content: "No custom Lightning Web Components found in this org.", isError: false };
  }

  let output = `Lightning Web Components (${bundles.length}):\n`;
  for (const b of bundles) {
    const desc = b.description ? ` — ${b.description}` : "";
    output += `  - ${b.developerName} (${b.masterLabel}) [API ${b.apiVersion}]${desc}\n`;
  }

  console.log(`RETURNED ${bundles.length} LWC BUNDLES`);
  return { content: output, isError: false };
}

async function executeGetLwcSource(
  developerName: string,
  componentCache: ComponentCacheService
): Promise<ToolResult> {
  console.log(`=== GET LWC SOURCE: ${developerName} ===`);
  const data = await componentCache.getLwcSource(developerName);

  let output = `LWC: ${data.developerName} (Bundle Id: ${data.bundleId})\nFiles: ${data.files.length}\n`;

  for (const file of data.files) {
    const ext = file.filePath.split(".").pop() || "";
    const lang = ext === "js" ? "javascript" : ext === "html" ? "html" : ext === "css" ? "css" : ext === "xml" ? "xml" : ext;
    output += `\n--- ${file.filePath} ---\n\`\`\`${lang}\n${file.source}\n\`\`\`\n`;
  }

  console.log(`RETURNED LWC SOURCE: ${data.developerName} (${data.files.length} files)`);
  return { content: output, isError: false };
}

// ─────────────────────────────────────────
// Apex Test handlers
// ─────────────────────────────────────────

async function executeRunApexTests(
  testClassNames: string[],
  conn: Connection
): Promise<ToolResult> {
  console.log(`=== RUN APEX TESTS: ${testClassNames.join(", ")} ===`);

  if (!testClassNames || testClassNames.length === 0) {
    return { content: "No test class names provided.", isError: true };
  }

  // Build the request body for runTestsSynchronous
  const tests = testClassNames.map((name) => ({ className: name }));

  console.log(`RUNNING ${tests.length} TEST CLASS(ES) SYNCHRONOUSLY...`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (conn as any).request({
    method: "POST",
    url: `/services/data/v${conn.version}/tooling/runTestsSynchronous`,
    body: JSON.stringify({ tests }),
    headers: { "Content-Type": "application/json" },
  });

  console.log(`TEST RUN COMPLETE: ${JSON.stringify(response).slice(0, 500)}`);

  // Parse results
  const numRun = response.numTestsRun || 0;
  const numFailures = response.numFailures || 0;
  const numPassed = numRun - numFailures;
  const totalTime = response.totalTime || 0;

  let output = `## Test Results\n`;
  output += `**${numPassed}/${numRun} passed** (${numFailures} failed) in ${totalTime}ms\n\n`;

  // Successes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const successes = response.successes || [];
  if (successes.length > 0) {
    output += `### Passed\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of successes) {
      output += `  - ${s.name}.${s.methodName} (${s.time}ms)\n`;
    }
    output += `\n`;
  }

  // Failures
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const failures = response.failures || [];
  if (failures.length > 0) {
    output += `### Failed\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of failures) {
      output += `  - **${f.name}.${f.methodName}** (${f.time}ms)\n`;
      if (f.message) output += `    Message: ${f.message}\n`;
      if (f.stackTrace) output += `    Stack: ${f.stackTrace}\n`;
    }
    output += `\n`;
  }

  // Code coverage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeCoverage = response.codeCoverage || [];
  if (codeCoverage.length > 0) {
    output += `### Code Coverage\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cov of codeCoverage) {
      const covered = cov.numLocations - cov.numLocationsNotCovered;
      const total = cov.numLocations;
      const pct = total > 0 ? Math.round((covered / total) * 100) : 100;
      output += `  - ${cov.name}: **${pct}%** (${covered}/${total} lines)\n`;
    }
  }

  console.log(`TEST SUMMARY: ${numPassed}/${numRun} passed, ${numFailures} failed`);
  return { content: output, isError: numFailures > 0 };
}

async function executeGetCodeCoverage(
  className: string,
  conn: Connection
): Promise<ToolResult> {
  console.log(`=== GET CODE COVERAGE: ${className} ===`);

  const result = await conn.tooling.query<{
    ApexClassOrTriggerId: string;
    ApexClassOrTrigger: { Name: string };
    NumLinesCovered: number;
    NumLinesUncovered: number;
  }>(
    `SELECT ApexClassOrTriggerId, ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTrigger.Name = '${className.replace(/'/g, "\\'")}'`
  );

  if (result.records.length === 0) {
    return {
      content: `No code coverage data found for "${className}". Run the relevant test class(es) first using run_apex_tests.`,
      isError: false,
    };
  }

  const record = result.records[0];
  const covered = record.NumLinesCovered;
  const uncovered = record.NumLinesUncovered;
  const total = covered + uncovered;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 100;

  const output = `Code Coverage for **${className}**: **${pct}%** (${covered}/${total} lines covered, ${uncovered} uncovered)`;

  console.log(`CODE COVERAGE: ${className} — ${pct}% (${covered}/${total})`);
  return { content: output, isError: false };
}

// ─────────────────────────────────────────
// Phase 2B — Write handlers
// ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatSaveErrors(errors: any[]): string {
  if (!errors || errors.length === 0) return "Unknown error";
  return errors
    .map((e: any) => {
      const line = e.fields ? ` (fields: ${e.fields.join(", ")})` : "";
      return `${e.statusCode || "ERROR"}: ${e.message}${line}`;
    })
    .join("\n");
}

async function executeCreateApexClass(
  className: string,
  body: string,
  conn: Connection,
  orgContext: OrgContextService,
  componentCache: ComponentCacheService,
  orgType: string
): Promise<ToolResult> {
  assertWritableOrg(orgType);
  console.log(`=== CREATE APEX CLASS: ${className} ===`);
  console.log(`BODY LENGTH: ${body.length} chars`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (conn.tooling as any).create("ApexClass", {
    Name: className,
    Body: body,
  });

  console.log(`CREATE RESULT: success=${result.success} id=${result.id}`);

  if (!result.success) {
    const errorMsg = formatSaveErrors(result.errors);
    console.log(`CREATE FAILED — COMPILE ERRORS:\n${errorMsg}`);
    return {
      content: `Failed to create Apex class "${className}".\n\nCompile errors:\n${errorMsg}`,
      isError: true,
    };
  }

  // Invalidate caches
  await Promise.all([
    orgContext.invalidateCache("apex_classes"),
    componentCache.invalidateComponent("apex_class", className),
  ]);

  console.log(`=== CREATE APEX CLASS SUCCESS: ${className} (${result.id}) ===`);
  return {
    content: `Apex class "${className}" created successfully.\nId: ${result.id}`,
    isError: false,
  };
}

async function executeUpdateApexClass(
  className: string,
  body: string,
  conn: Connection,
  orgContext: OrgContextService,
  componentCache: ComponentCacheService,
  orgType: string
): Promise<ToolResult> {
  assertWritableOrg(orgType);
  console.log(`=== UPDATE APEX CLASS: ${className} ===`);
  console.log(`NEW BODY LENGTH: ${body.length} chars`);

  // Look up the class ID by name
  const existing = await componentCache.getApexClassBody(className);
  console.log(`FOUND EXISTING CLASS: ${existing.name} (${existing.id})`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (conn.tooling as any).update("ApexClass", {
    Id: existing.id,
    Body: body,
  });

  console.log(`UPDATE RESULT: success=${result.success}`);

  if (!result.success) {
    const errorMsg = formatSaveErrors(result.errors);
    console.log(`UPDATE FAILED — COMPILE ERRORS:\n${errorMsg}`);
    return {
      content: `Failed to update Apex class "${className}".\n\nCompile errors:\n${errorMsg}`,
      isError: true,
    };
  }

  // Invalidate caches
  await Promise.all([
    orgContext.invalidateCache("apex_classes"),
    componentCache.invalidateComponent("apex_class", className),
  ]);

  console.log(`=== UPDATE APEX CLASS SUCCESS: ${className} ===`);
  return {
    content: `Apex class "${className}" updated successfully.`,
    isError: false,
  };
}

async function executeCreateApexTrigger(
  triggerName: string,
  sobjectName: string,
  body: string,
  conn: Connection,
  orgContext: OrgContextService,
  componentCache: ComponentCacheService,
  orgType: string
): Promise<ToolResult> {
  assertWritableOrg(orgType);
  console.log(`=== CREATE APEX TRIGGER: ${triggerName} on ${sobjectName} ===`);
  console.log(`BODY LENGTH: ${body.length} chars`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (conn.tooling as any).create("ApexTrigger", {
    Name: triggerName,
    TableEnumOrId: sobjectName,
    Body: body,
  });

  console.log(`CREATE RESULT: success=${result.success} id=${result.id}`);

  if (!result.success) {
    const errorMsg = formatSaveErrors(result.errors);
    console.log(`CREATE FAILED — COMPILE ERRORS:\n${errorMsg}`);
    return {
      content: `Failed to create Apex trigger "${triggerName}".\n\nCompile errors:\n${errorMsg}`,
      isError: true,
    };
  }

  // Invalidate caches
  await componentCache.invalidateComponent("apex_trigger", triggerName);

  console.log(`=== CREATE APEX TRIGGER SUCCESS: ${triggerName} (${result.id}) ===`);
  return {
    content: `Apex trigger "${triggerName}" on ${sobjectName} created successfully.\nId: ${result.id}`,
    isError: false,
  };
}

async function executeUpdateApexTrigger(
  triggerName: string,
  body: string,
  conn: Connection,
  orgContext: OrgContextService,
  componentCache: ComponentCacheService,
  orgType: string
): Promise<ToolResult> {
  assertWritableOrg(orgType);
  console.log(`=== UPDATE APEX TRIGGER: ${triggerName} ===`);
  console.log(`NEW BODY LENGTH: ${body.length} chars`);

  // Look up the trigger ID by name
  const existing = await componentCache.getApexTriggerBody(triggerName);
  console.log(`FOUND EXISTING TRIGGER: ${existing.name} (${existing.id})`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (conn.tooling as any).update("ApexTrigger", {
    Id: existing.id,
    Body: body,
  });

  console.log(`UPDATE RESULT: success=${result.success}`);

  if (!result.success) {
    const errorMsg = formatSaveErrors(result.errors);
    console.log(`UPDATE FAILED — COMPILE ERRORS:\n${errorMsg}`);
    return {
      content: `Failed to update Apex trigger "${triggerName}".\n\nCompile errors:\n${errorMsg}`,
      isError: true,
    };
  }

  // Invalidate caches
  await componentCache.invalidateComponent("apex_trigger", triggerName);

  console.log(`=== UPDATE APEX TRIGGER SUCCESS: ${triggerName} ===`);
  return {
    content: `Apex trigger "${triggerName}" updated successfully.`,
    isError: false,
  };
}
