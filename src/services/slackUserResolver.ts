import { prisma } from "../lib/prisma";
import { slackService } from "./slack";

interface ResolvedUser {
  userId: string;
  accountId: string;
}

export async function resolveSlackUser(
  accessToken: string,
  slackUserId: string,
  accountId: string
): Promise<ResolvedUser | null> {
  // Get the Slack user's email from the Slack API
  const slackUser = await slackService.getUserInfo(accessToken, slackUserId);

  if (!slackUser.email) {
    return null;
  }

  // Look up the ForceClaw user by email
  const user = await prisma.user.findUnique({
    where: { email: slackUser.email },
  });

  if (!user) {
    return null;
  }

  // Verify the user belongs to the same account as the Slack connection
  if (user.accountId !== accountId) {
    return null;
  }

  return {
    userId: user.id,
    accountId: user.accountId,
  };
}
