import { prisma } from "../lib/prisma";
import jsforce from "jsforce";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  instance_url: string;
  id: string;
}

interface OrgTokenResult {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  salesforceOrgId: string;
  orgName: string;
}

interface CredentialLoginResult {
  accessToken: string;
  instanceUrl: string;
  salesforceOrgId: string;
  orgName: string;
  orgType: "sandbox" | "developer" | "production";
}

export class SalesforceService {
  /**
   * Authenticate using OAuth 2.0 Client Credentials Flow.
   * Only requires consumerKey, consumerSecret, and loginUrl.
   * The "Run As" user is configured on the External Client App in Salesforce.
   */
  async loginWithClientCredentials(params: {
    consumerKey: string;
    consumerSecret: string;
    loginUrl: string;
  }): Promise<CredentialLoginResult> {
    const tokenUrl = `${params.loginUrl}/services/oauth2/token`;

    // Step 1: Get access token via client_credentials grant
    console.log("Requesting token from:", tokenUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let oauthResponse: Response;
    try {
      oauthResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: params.consumerKey,
          client_secret: params.consumerSecret,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
        throw new Error(
          "Salesforce token request timed out after 30 seconds. Check that your Salesforce Domain is correct."
        );
      }
      throw new Error(
        `Failed to connect to Salesforce: ${fetchErr instanceof Error ? fetchErr.message : "Network error"}`
      );
    }
    clearTimeout(timeout);

    console.log("Token response status:", oauthResponse.status);

    if (!oauthResponse.ok) {
      const errorText = await oauthResponse.text().catch(() => "");
      console.error("Token error response:", errorText);
      let errorMessage = "Unknown error";
      try {
        const errorBody = JSON.parse(errorText) as {
          error?: string;
          error_description?: string;
        };
        errorMessage =
          errorBody.error_description || errorBody.error || errorMessage;
      } catch {
        // Response was not JSON
        if (errorText) errorMessage = errorText.slice(0, 200);
      }
      throw new Error(
        `Client Credentials authentication failed: ${errorMessage}. ` +
          "Check that your Consumer Key and Secret are correct, and that the External Client App has Client Credentials Flow enabled with a Run As user configured."
      );
    }

    const oauthData = (await oauthResponse.json()) as {
      access_token: string;
      instance_url: string;
    };
    console.log(
      "Token obtained, instance_url:",
      oauthData.instance_url
    );

    // Step 2: Query org info using the access token
    const conn = new jsforce.Connection({
      instanceUrl: oauthData.instance_url,
      accessToken: oauthData.access_token,
    });

    console.log("Querying Organization info...");
    const orgInfo = await conn.query<{
      Id: string;
      Name: string;
      IsSandbox: boolean;
      OrganizationType: string;
    }>(
      "SELECT Id, Name, IsSandbox, OrganizationType FROM Organization LIMIT 1"
    );
    console.log("Org info retrieved:", orgInfo.records[0]?.Name);

    const record = orgInfo.records[0];

    // Determine org type
    let orgType: "sandbox" | "developer" | "production";
    if (record.IsSandbox) {
      orgType = "sandbox";
    } else if (
      record.OrganizationType === "Developer Edition" ||
      record.OrganizationType === "Developer"
    ) {
      orgType = "developer";
    } else {
      orgType = "production";
    }

    return {
      accessToken: oauthData.access_token,
      instanceUrl: oauthData.instance_url,
      salesforceOrgId: record.Id,
      orgName: record.Name,
      orgType,
    };
  }

  buildAuthorizationUrl(accountId: string): string {
    const clientId = process.env.SALESFORCE_CONSUMER_KEY;
    const callbackUrl = process.env.SALESFORCE_CALLBACK_URL;

    if (!clientId || !callbackUrl) {
      throw new Error("Salesforce OAuth environment variables not configured");
    }

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: "api refresh_token offline_access",
      state: accountId,
    });

    return `https://login.salesforce.com/services/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<OrgTokenResult> {
    const clientId = process.env.SALESFORCE_CONSUMER_KEY;
    const clientSecret = process.env.SALESFORCE_CONSUMER_SECRET;
    const callbackUrl = process.env.SALESFORCE_CALLBACK_URL;

    if (!clientId || !clientSecret || !callbackUrl) {
      throw new Error("Salesforce OAuth environment variables not configured");
    }

    const tokenResponse = await fetch(
      "https://login.salesforce.com/services/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      throw new Error(`Salesforce token exchange failed: ${errorBody}`);
    }

    const tokenData = (await tokenResponse.json()) as TokenResponse;

    // The identity URL format: https://login.salesforce.com/id/orgId/userId
    const idParts = tokenData.id.split("/");
    const salesforceOrgId = idParts[idParts.length - 2];

    // Fetch org name from Salesforce identity endpoint
    const identityResponse = await fetch(tokenData.id, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let orgName = "Salesforce Org";
    if (identityResponse.ok) {
      const identity = (await identityResponse.json()) as {
        organization_id: string;
        display_name?: string;
        username?: string;
      };
      orgName =
        identity.display_name || identity.username || "Salesforce Org";
    }

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      instanceUrl: tokenData.instance_url,
      salesforceOrgId,
      orgName,
    };
  }

  async refreshToken(orgId: string): Promise<void> {
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { refreshToken: true },
    });

    if (!org?.refreshToken) {
      throw new Error("No refresh token available");
    }

    const clientId = process.env.SALESFORCE_CONSUMER_KEY;
    const clientSecret = process.env.SALESFORCE_CONSUMER_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("Salesforce OAuth environment variables not configured");
    }

    const tokenResponse = await fetch(
      "https://login.salesforce.com/services/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: org.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      }
    );

    if (!tokenResponse.ok) {
      await prisma.org.update({
        where: { id: orgId },
        data: { tokenStatus: "expired" },
      });
      throw new Error("Token refresh failed");
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      instance_url: string;
    };

    await prisma.org.update({
      where: { id: orgId },
      data: {
        accessToken: tokenData.access_token,
        instanceUrl: tokenData.instance_url,
        tokenStatus: "valid",
      },
    });
  }

  async getOrgMetadata(
    _orgId: string
  ): Promise<{ name: string; type: string }> {
    throw new Error("Not implemented");
  }

  async listSandboxes(_orgId: string): Promise<unknown[]> {
    throw new Error("Not implemented");
  }
}

export const salesforceService = new SalesforceService();
