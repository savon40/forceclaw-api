export class SlackService {
  async getConnectionStatus(
    _accountId: string
  ): Promise<{ connected: boolean; workspaceName?: string }> {
    throw new Error("Not implemented");
  }

  async initiateOAuth(_accountId: string): Promise<string> {
    throw new Error("Not implemented");
  }

  async disconnect(_accountId: string): Promise<void> {
    throw new Error("Not implemented");
  }
}

export const slackService = new SlackService();
