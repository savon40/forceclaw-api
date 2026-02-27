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
   * List all LWC bundles in the org via Tooling API.
   */
  async getLwcBundles(): Promise<{ id: string; developerName: string; masterLabel: string; apiVersion: string; description: string | null }[]> {
    const cacheKey = "lwc_bundles";

    const cached = await this.getCached(cacheKey);
    if (cached) return cached as { id: string; developerName: string; masterLabel: string; apiVersion: string; description: string | null }[];

    console.log(`=== FETCHING LWC BUNDLES FOR ORG: ${this.orgId} ===`);
    const result = await this.conn.tooling.query<{
      Id: string;
      DeveloperName: string;
      MasterLabel: string;
      ApiVersion: string;
      Description: string | null;
      NamespacePrefix: string | null;
    }>(
      "SELECT Id, DeveloperName, MasterLabel, ApiVersion, Description, NamespacePrefix FROM LightningComponentBundle WHERE NamespacePrefix = null ORDER BY DeveloperName LIMIT 2000"
    );

    const bundles = result.records.map((r) => ({
      id: r.Id,
      developerName: r.DeveloperName,
      masterLabel: r.MasterLabel,
      apiVersion: r.ApiVersion,
      description: r.Description,
    }));

    console.log(`FETCHED ${bundles.length} LWC BUNDLES`);
    await this.setCache(cacheKey, bundles);
    return bundles;
  }

  /**
   * Get all source files for a specific LWC bundle via Tooling API.
   */
  async getLwcSource(developerName: string): Promise<{ bundleId: string; developerName: string; files: { filePath: string; source: string }[] }> {
    validateName(developerName, "LWC");
    const cacheKey = `lwc:${developerName}`;

    const cached = await this.getCached(cacheKey);
    if (cached) return cached as { bundleId: string; developerName: string; files: { filePath: string; source: string }[] };

    console.log(`=== FETCHING LWC SOURCE: ${developerName} ===`);

    // First find the bundle ID
    const bundleResult = await this.conn.tooling.query<{
      Id: string;
      DeveloperName: string;
    }>(`SELECT Id, DeveloperName FROM LightningComponentBundle WHERE DeveloperName = '${developerName}' LIMIT 1`);

    if (bundleResult.records.length === 0) {
      throw new Error(`LWC bundle not found: "${developerName}". Check the name and try again.`);
    }

    const bundleId = bundleResult.records[0].Id;

    // Fetch all resources in the bundle
    const resourceResult = await this.conn.tooling.query<{
      Id: string;
      FilePath: string;
      Source: string;
    }>(`SELECT Id, FilePath, Source FROM LightningComponentResource WHERE LightningComponentBundleId = '${bundleId}'`);

    const files = resourceResult.records.map((r) => ({
      filePath: r.FilePath,
      source: r.Source,
    }));

    const data = {
      bundleId,
      developerName,
      files,
    };

    console.log(`FETCHED LWC SOURCE: ${developerName} — ${files.length} files (${files.map(f => f.filePath).join(", ")})`);
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
