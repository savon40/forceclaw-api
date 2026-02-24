export class SlackService {
  buildAuthorizationUrl(accountId: string): string {
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUri = process.env.SLACK_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new Error("Slack OAuth environment variables not configured");
    }

    const params = new URLSearchParams({
      client_id: clientId,
      scope: "chat:write,channels:read,incoming-webhook",
      redirect_uri: redirectUri,
      state: accountId,
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async exchangeCodeForTokens(
    code: string
  ): Promise<{
    accessToken: string;
    workspaceId: string;
    workspaceName: string;
    botUserId: string;
  }> {
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    const redirectUri = process.env.SLACK_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Slack OAuth environment variables not configured");
    }

    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const data = (await tokenResponse.json()) as {
      ok: boolean;
      access_token: string;
      team: { id: string; name: string };
      bot_user_id: string;
      error?: string;
    };

    if (!data.ok) {
      throw new Error(`Slack OAuth failed: ${data.error}`);
    }

    return {
      accessToken: data.access_token,
      workspaceId: data.team.id,
      workspaceName: data.team.name,
      botUserId: data.bot_user_id,
    };
  }
}

export const slackService = new SlackService();
