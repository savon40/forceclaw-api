export class SalesforceService {
  async initiateOAuth(_accountId: string): Promise<string> {
    throw new Error("Not implemented");
  }

  async handleOAuthCallback(
    _code: string,
    _accountId: string
  ): Promise<{ orgId: string }> {
    throw new Error("Not implemented");
  }

  async refreshToken(_orgId: string): Promise<void> {
    throw new Error("Not implemented");
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
