import crypto from "crypto";

export class SlackService {
  verifySignature(signature: string, timestamp: string, rawBody: string): boolean {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      throw new Error("SLACK_SIGNING_SECRET not configured");
    }

    // Reject requests older than 5 minutes to prevent replay attacks
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    if (parseInt(timestamp, 10) < fiveMinutesAgo) {
      return false;
    }

    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const mySignature =
      "v0=" +
      crypto
        .createHmac("sha256", signingSecret)
        .update(sigBasestring)
        .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(mySignature),
      Buffer.from(signature)
    );
  }

  async postMessage(
    accessToken: string,
    channel: string,
    text: string
  ): Promise<{ ts: string }> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text }),
    });

    const data = (await response.json()) as { ok: boolean; ts: string; error?: string };
    if (!data.ok) {
      throw new Error(`Slack postMessage failed: ${data.error}`);
    }
    return { ts: data.ts };
  }

  async postThreadReply(
    accessToken: string,
    channel: string,
    threadTs: string,
    text: string
  ): Promise<void> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text, thread_ts: threadTs }),
    });

    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack postThreadReply failed: ${data.error}`);
    }
  }

  async postBlockMessage(
    accessToken: string,
    channel: string,
    threadTs: string,
    blocks: unknown[],
    text?: string
  ): Promise<void> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        thread_ts: threadTs,
        blocks,
        text: text || "ForceClaw",
      }),
    });

    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack postBlockMessage failed: ${data.error}`);
    }
  }

  async getUserInfo(
    accessToken: string,
    userId: string
  ): Promise<{ email: string; realName: string }> {
    const response = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = (await response.json()) as {
      ok: boolean;
      user?: { profile: { email?: string; real_name?: string } };
      error?: string;
    };
    if (!data.ok || !data.user) {
      throw new Error(`Slack getUserInfo failed: ${data.error}`);
    }

    return {
      email: data.user.profile.email || "",
      realName: data.user.profile.real_name || "",
    };
  }

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
