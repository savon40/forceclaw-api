import { Connection } from "jsforce";
import { supabaseAdmin } from "./supabase";

const COMPONENT_TTL = 3600; // 1 hour
const NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

interface CachedComponent {
  data: unknown;
  fetched_at: string;
  ttl_seconds: number;
}

function validateName(name: string, label: string): void {
  if (!NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid ${label} name: "${name}". Names must start with a letter or underscore and contain only letters, numbers, and underscores.`
    );
  }
}

export class ComponentCacheService {
  constructor(
    private orgId: string,
    private conn: Connection
  ) {}

  /**
   * Check org_component_cache for a cached component. Returns null if stale or missing.
   */
  private async getCached(cacheKey: string): Promise<unknown | null> {
    console.log(`COMPONENT CACHE CHECK: org=${this.orgId} key=${cacheKey}`);

    const { data, error } = await supabaseAdmin
      .from("org_component_cache")
      .select("data, fetched_at, ttl_seconds")
      .eq("org_id", this.orgId)
      .eq("cache_key", cacheKey)
      .single();

    if (error || !data) {
      console.log(`COMPONENT CACHE MISS: ${cacheKey} (no entry)`);
      return null;
    }

    const cached = data as CachedComponent;
    const fetchedAt = new Date(cached.fetched_at).getTime();
    const expiresAt = fetchedAt + cached.ttl_seconds * 1000;

    if (Date.now() > expiresAt) {
      console.log(`COMPONENT CACHE EXPIRED: ${cacheKey} (fetched ${cached.fetched_at})`);
      return null;
    }

    console.log(`COMPONENT CACHE HIT: ${cacheKey}`);
    return cached.data;
  }

  /**
   * Write component data to org_component_cache (upsert).
   */
  private async setCache(cacheKey: string, data: unknown): Promise<void> {
    console.log(`COMPONENT CACHE WRITE: org=${this.orgId} key=${cacheKey}`);

    const { error } = await supabaseAdmin
      .from("org_component_cache")
      .upsert(
        {
          org_id: this.orgId,
          cache_key: cacheKey,
          data,
          fetched_at: new Date().toISOString(),
          ttl_seconds: COMPONENT_TTL,
        },
        { onConflict: "org_id,cache_key" }
      );

    if (error) {
      console.error(`COMPONENT CACHE WRITE ERROR: ${cacheKey}:`, error.message);
    }
  }

  /**
   * Delete a cached component entry (called after writes).
   */
  async invalidateComponent(type: string, name: string): Promise<void> {
    const cacheKey = `${type}:${name}`;
    console.log(`COMPONENT CACHE INVALIDATE: org=${this.orgId} key=${cacheKey}`);

    const { error } = await supabaseAdmin
      .from("org_component_cache")
      .delete()
      .eq("org_id", this.orgId)
      .eq("cache_key", cacheKey);

    if (error) {
      console.error(`COMPONENT CACHE INVALIDATE ERROR: ${cacheKey}:`, error.message);
    }
  }

  /**
   * Get full Apex class source code via Tooling API.
   */
  async getApexClassBody(name: string): Promise<{ id: string; name: string; body: string }> {
    validateName(name, "Apex class");
    const cacheKey = `apex_class:${name}`;

    const cached = await this.getCached(cacheKey);
    if (cached) return cached as { id: string; name: string; body: string };

    console.log(`=== FETCHING APEX CLASS BODY: ${name} ===`);
    const result = await this.conn.tooling.query<{
      Id: string;
      Name: string;
      Body: string;
    }>(`SELECT Id, Name, Body FROM ApexClass WHERE Name = '${name}' LIMIT 1`);

    if (result.records.length === 0) {
      throw new Error(`Apex class not found: "${name}". Check the name and try again.`);
    }

    const record = result.records[0];
    const data = {
      id: record.Id,
      name: record.Name,
      body: record.Body,
    };

    console.log(`FETCHED APEX CLASS BODY: ${name} (${record.Body.length} chars)`);
    await this.setCache(cacheKey, data);
    return data;
  }

  /**
   * Get full Apex trigger source code via Tooling API.
   */
  async getApexTriggerBody(name: string): Promise<{ id: string; name: string; body: string; tableEnumOrId: string }> {
    validateName(name, "Apex trigger");
    const cacheKey = `apex_trigger:${name}`;

    const cached = await this.getCached(cacheKey);
    if (cached) return cached as { id: string; name: string; body: string; tableEnumOrId: string };

    console.log(`=== FETCHING APEX TRIGGER BODY: ${name} ===`);
    const result = await this.conn.tooling.query<{
      Id: string;
      Name: string;
      Body: string;
      TableEnumOrId: string;
    }>(`SELECT Id, Name, Body, TableEnumOrId FROM ApexTrigger WHERE Name = '${name}' LIMIT 1`);

    if (result.records.length === 0) {
      throw new Error(`Apex trigger not found: "${name}". Check the name and try again.`);
    }

    const record = result.records[0];
    const data = {
      id: record.Id,
      name: record.Name,
      body: record.Body,
      tableEnumOrId: record.TableEnumOrId,
    };

    console.log(`FETCHED APEX TRIGGER BODY: ${name} on ${record.TableEnumOrId} (${record.Body.length} chars)`);
    await this.setCache(cacheKey, data);
    return data;
  }

  /**
   * Get flow definition/metadata via Tooling API.
   */
  async getFlowDefinition(apiName: string): Promise<{ id: string; apiName: string; label: string; processType: string; metadata: unknown }> {
    validateName(apiName, "Flow");
    const cacheKey = `flow:${apiName}`;

    const cached = await this.getCached(cacheKey);
    if (cached) return cached as { id: string; apiName: string; label: string; processType: string; metadata: unknown };

    console.log(`=== FETCHING FLOW DEFINITION: ${apiName} ===`);
    const result = await this.conn.tooling.query<{
      Id: string;
      DeveloperName: string;
      MasterLabel: string;
      ProcessType: string;
      Metadata: unknown;
    }>(`SELECT Id, DeveloperName, MasterLabel, ProcessType, Metadata FROM Flow WHERE DeveloperName = '${apiName}' AND Status = 'Active' LIMIT 1`);

    if (result.records.length === 0) {
      // Try without the Active filter in case it's a draft
      const fallbackResult = await this.conn.tooling.query<{
        Id: string;
        DeveloperName: string;
        MasterLabel: string;
        ProcessType: string;
        Metadata: unknown;
      }>(`SELECT Id, DeveloperName, MasterLabel, ProcessType, Metadata FROM Flow WHERE DeveloperName = '${apiName}' ORDER BY VersionNumber DESC LIMIT 1`);

      if (fallbackResult.records.length === 0) {
        throw new Error(`Flow not found: "${apiName}". Check the API name and try again.`);
      }

      const record = fallbackResult.records[0];
      const data = {
        id: record.Id,
        apiName: record.DeveloperName,
        label: record.MasterLabel,
        processType: record.ProcessType,
        metadata: record.Metadata,
      };

      console.log(`FETCHED FLOW DEFINITION (draft/inactive): ${apiName} — ${record.ProcessType}`);
      await this.setCache(cacheKey, data);
      return data;
    }

    const record = result.records[0];
    const data = {
      id: record.Id,
      apiName: record.DeveloperName,
      label: record.MasterLabel,
      processType: record.ProcessType,
      metadata: record.Metadata,
    };

    console.log(`FETCHED FLOW DEFINITION: ${apiName} — ${record.ProcessType}`);
    await this.setCache(cacheKey, data);
    return data;
  }
}
