import type Anthropic from "@anthropic-ai/sdk";
import { Connection } from "jsforce";
import { OrgContextService } from "../services/orgContext";

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
];

interface ToolResult {
  content: string;
  isError: boolean;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  orgContext: OrgContextService,
  conn: Connection
): Promise<ToolResult> {
  console.log(`=== TOOL EXECUTION: ${name} ===`);
  console.log(`TOOL INPUT: ${JSON.stringify(input)}`);

  try {
    switch (name) {
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
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`TOOL ERROR (${name}): ${message}`);
    return { content: `Error: ${message}`, isError: true };
  }
}

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
