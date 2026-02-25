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
  async loginWithCredentials(params: {
    username: string;
    password: string;
    securityToken: string;
    loginUrl: string;
    consumerKey: string;
    consumerSecret: string;
  }): Promise<CredentialLoginResult> {
    // Step 1: SOAP login to verify user credentials and get org info
    const conn = new jsforce.Connection({ loginUrl: params.loginUrl });
    await conn.login(
      params.username,
      params.password + params.securityToken
    );

    // Query Organization sObject for org name, type, and sandbox flag
    const orgInfo = await conn.query<{
      Id: string;
      Name: string;
      IsSandbox: boolean;
      OrganizationType: string;
    }>("SELECT Id, Name, IsSandbox, OrganizationType FROM Organization LIMIT 1");

    const record = orgInfo.records[0];

    // Step 2: Validate the Connected App via OAuth2 password grant.
    // This confirms the consumer key/secret are correct and the app is active.
    const tokenUrl = `${params.loginUrl}/services/oauth2/token`;
    const oauthResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: params.consumerKey,
        client_secret: params.consumerSecret,
        username: params.username,
        password: params.password + params.securityToken,
      }),
    });

    if (!oauthResponse.ok) {
      const errorBody = (await oauthResponse.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      throw new Error(
        `Connected App validation failed: ${errorBody.error_description || errorBody.error || "Unknown error"}. ` +
        "Check that your Consumer Key and Secret are correct, and that the app allows OAuth Username-Password Flow."
      );
    }

    // Use the OAuth2 token (from the Connected App) as the stored access token
    const oauthData = (await oauthResponse.json()) as {
      access_token: string;
      instance_url: string;
      refresh_token?: string;
    };

    // Determine org type: sandbox, developer edition, or production
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
