import { Connection } from "jsforce";
import { supabaseAdmin } from "./supabase";

interface CachedMetadata {
  data: unknown;
  fetched_at: string;
  ttl_seconds: number;
}

interface SObjectSummary {
  name: string;
  label: string;
  custom: boolean;
  queryable: boolean;
}

interface FlowSummary {
  id: string;
  name: string;
  label: string;
  processType: string;
  status: string;
}

interface ApexClassSummary {
  id: string;
  name: string;
  lengthWithoutComments: number;
}

interface PermissionSetSummary {
  id: string;
  name: string;
  label: string;
  isCustom: boolean;
}

// Cache TTLs in seconds
const TTL = {
  objects: 86400,      // 24 hours
  flows: 21600,        // 6 hours
  apex_classes: 21600, // 6 hours
  permission_sets: 43200, // 12 hours
} as const;

export class OrgContextService {
  constructor(
    private orgId: string,
    private conn: Connection
  ) {}

  /**
   * Check Supabase cache for metadata. Returns null if stale or missing.
   */
  private async getCached(cacheKey: string): Promise<unknown | null> {
    console.log(`CACHE CHECK: org=${this.orgId} key=${cacheKey}`);

    const { data, error } = await supabaseAdmin
      .from("org_metadata_cache")
      .select("data, fetched_at, ttl_seconds")
      .eq("org_id", this.orgId)
      .eq("cache_key", cacheKey)
      .single();

    if (error || !data) {
      console.log(`CACHE MISS: ${cacheKey} (no entry)`);
      return null;
    }

    const cached = data as CachedMetadata;
    const fetchedAt = new Date(cached.fetched_at).getTime();
    const expiresAt = fetchedAt + cached.ttl_seconds * 1000;

    if (Date.now() > expiresAt) {
      console.log(`CACHE EXPIRED: ${cacheKey} (fetched ${cached.fetched_at})`);
      return null;
    }

    console.log(`CACHE HIT: ${cacheKey}`);
    return cached.data;
  }

  /**
   * Write metadata to Supabase cache (upsert).
   */
  private async setCache(cacheKey: string, data: unknown, ttlSeconds: number): Promise<void> {
    console.log(`CACHE WRITE: org=${this.orgId} key=${cacheKey} ttl=${ttlSeconds}s`);

    const { error } = await supabaseAdmin
      .from("org_metadata_cache")
      .upsert(
        {
          org_id: this.orgId,
          cache_key: cacheKey,
          data,
          fetched_at: new Date().toISOString(),
          ttl_seconds: ttlSeconds,
        },
        { onConflict: "org_id,cache_key" }
      );

    if (error) {
      console.error(`CACHE WRITE ERROR: ${cacheKey}:`, error.message);
    }
  }

  /**
   * Get all sObjects in the org (custom + standard queryable).
   */
  async getObjects(): Promise<SObjectSummary[]> {
    const cached = await this.getCached("objects");
    if (cached) return cached as SObjectSummary[];

    console.log(`FETCHING OBJECTS FROM SALESFORCE FOR ORG: ${this.orgId}`);
    const describeResult = await this.conn.describeGlobal();

    const objects: SObjectSummary[] = describeResult.sobjects
      .filter((s: { queryable: boolean }) => s.queryable)
      .map((s: { name: string; label: string; custom: boolean; queryable: boolean }) => ({
        name: s.name,
        label: s.label,
        custom: s.custom,
        queryable: s.queryable,
      }));

    console.log(`FETCHED ${objects.length} QUERYABLE OBJECTS`);
    await this.setCache("objects", objects, TTL.objects);
    return objects;
  }

  /**
   * Get all active Flows in the org.
   */
  async getFlows(): Promise<FlowSummary[]> {
    const cached = await this.getCached("flows");
    if (cached) return cached as FlowSummary[];

    console.log(`FETCHING FLOWS FROM SALESFORCE FOR ORG: ${this.orgId}`);
    const result = await this.conn.query<{
      Id: string;
      Definition: { DeveloperName: string };
      MasterLabel: string;
      ProcessType: string;
      Status: string;
    }>(
      "SELECT Id, Definition.DeveloperName, MasterLabel, ProcessType, Status FROM FlowVersionView WHERE Status = 'Active' ORDER BY MasterLabel LIMIT 500"
    );

    const flows: FlowSummary[] = result.records.map((r: { Id: string; Definition?: { DeveloperName: string }; MasterLabel: string; ProcessType: string; Status: string }) => ({
      id: r.Id,
      name: r.Definition?.DeveloperName || "Unknown",
      label: r.MasterLabel,
      processType: r.ProcessType,
      status: r.Status,
    }));

    console.log(`FETCHED ${flows.length} ACTIVE FLOWS`);
    await this.setCache("flows", flows, TTL.flows);
    return flows;
  }

  /**
   * Get all Apex classes in the org.
   */
  async getApexClasses(): Promise<ApexClassSummary[]> {
    const cached = await this.getCached("apex_classes");
    if (cached) return cached as ApexClassSummary[];

    console.log(`FETCHING APEX CLASSES FROM SALESFORCE FOR ORG: ${this.orgId}`);
    const result = await this.conn.query<{
      Id: string;
      Name: string;
      LengthWithoutComments: number;
    }>(
      "SELECT Id, Name, LengthWithoutComments FROM ApexClass WHERE NamespacePrefix = null ORDER BY Name LIMIT 1000"
    );

    const classes: ApexClassSummary[] = result.records.map((r: { Id: string; Name: string; LengthWithoutComments: number }) => ({
      id: r.Id,
      name: r.Name,
      lengthWithoutComments: r.LengthWithoutComments,
    }));

    console.log(`FETCHED ${classes.length} APEX CLASSES`);
    await this.setCache("apex_classes", classes, TTL.apex_classes);
    return classes;
  }

  /**
   * Get permission sets in the org.
   */
  async getPermissionSets(): Promise<PermissionSetSummary[]> {
    const cached = await this.getCached("permission_sets");
    if (cached) return cached as PermissionSetSummary[];

    console.log(`FETCHING PERMISSION SETS FROM SALESFORCE FOR ORG: ${this.orgId}`);
    const result = await this.conn.query<{
      Id: string;
      Name: string;
      Label: string;
      IsCustom: boolean;
    }>(
      "SELECT Id, Name, Label, IsCustom FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label LIMIT 500"
    );

    const permSets: PermissionSetSummary[] = result.records.map((r: { Id: string; Name: string; Label: string; IsCustom: boolean }) => ({
      id: r.Id,
      name: r.Name,
      label: r.Label,
      isCustom: r.IsCustom,
    }));

    console.log(`FETCHED ${permSets.length} PERMISSION SETS`);
    await this.setCache("permission_sets", permSets, TTL.permission_sets);
    return permSets;
  }

  /**
   * Build a compressed org summary for the Claude system prompt (~500-1000 tokens).
   */
  async buildOrgSummary(): Promise<string> {
    console.log(`=== BUILDING ORG SUMMARY START ===`);

    // Fetch all metadata in parallel
    const [objects, flows, apexClasses, permissionSets] = await Promise.all([
      this.getObjects().catch((err) => {
        console.error("FAILED TO FETCH OBJECTS:", err.message);
        return [] as SObjectSummary[];
      }),
      this.getFlows().catch((err) => {
        console.error("FAILED TO FETCH FLOWS:", err.message);
        return [] as FlowSummary[];
      }),
      this.getApexClasses().catch((err) => {
        console.error("FAILED TO FETCH APEX CLASSES:", err.message);
        return [] as ApexClassSummary[];
      }),
      this.getPermissionSets().catch((err) => {
        console.error("FAILED TO FETCH PERMISSION SETS:", err.message);
        return [] as PermissionSetSummary[];
      }),
    ]);

    const customObjects = objects.filter((o) => o.custom);
    const standardObjects = objects.filter((o) => !o.custom);

    const lines: string[] = [];

    // Custom objects
    if (customObjects.length > 0) {
      lines.push(`Custom Objects (${customObjects.length}):`);
      lines.push(customObjects.map((o) => `  ${o.name} (${o.label})`).join("\n"));
    }

    // Standard objects (just count + notable ones)
    lines.push(`Standard Objects: ${standardObjects.length} queryable`);

    // Flows
    if (flows.length > 0) {
      lines.push(`\nActive Flows (${flows.length}):`);
      const flowsByType = new Map<string, FlowSummary[]>();
      for (const f of flows) {
        const list = flowsByType.get(f.processType) || [];
        list.push(f);
        flowsByType.set(f.processType, list);
      }
      for (const [type, typeFlows] of flowsByType) {
        lines.push(`  ${type} (${typeFlows.length}): ${typeFlows.slice(0, 10).map((f) => f.name).join(", ")}${typeFlows.length > 10 ? "..." : ""}`);
      }
    }

    // Apex classes
    if (apexClasses.length > 0) {
      lines.push(`\nApex Classes (${apexClasses.length}):`);
      const top = apexClasses.slice(0, 30);
      lines.push(`  ${top.map((c) => c.name).join(", ")}${apexClasses.length > 30 ? `, ... and ${apexClasses.length - 30} more` : ""}`);
    }

    // Permission sets
    if (permissionSets.length > 0) {
      const customPS = permissionSets.filter((p) => p.isCustom);
      lines.push(`\nPermission Sets: ${permissionSets.length} total, ${customPS.length} custom`);
      if (customPS.length > 0) {
        lines.push(`  Custom: ${customPS.slice(0, 15).map((p) => p.label).join(", ")}${customPS.length > 15 ? "..." : ""}`);
      }
    }

    const summary = lines.join("\n");
    console.log(`ORG SUMMARY BUILT: ${summary.length} chars`);
    console.log(`=== BUILDING ORG SUMMARY END ===`);
    return summary;
  }
}
