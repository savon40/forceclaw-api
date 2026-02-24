import { prisma } from "../lib/prisma";

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

export class SalesforceService {
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
