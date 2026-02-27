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
  console.log(`=== SLACK USER RESOLVER START ===`);
  console.log(`LOOKING UP SLACK USER ID: ${slackUserId}`);

  const slackUser = await slackService.getUserInfo(accessToken, slackUserId);
  console.log(`SLACK API RETURNED - email: "${slackUser.email}", name: "${slackUser.realName}"`);

  if (!slackUser.email) {
    console.log(`NO EMAIL RETURNED FROM SLACK API - bot is missing users:read.email scope`);
    console.log(`=== SLACK USER RESOLVER END (no email) ===`);
    return null;
  }

  console.log(`CHECKING DATABASE FOR USER WITH EMAIL: ${slackUser.email.toUpperCase()}`);
  const user = await prisma.user.findUnique({
    where: { email: slackUser.email },
  });
  console.log(`DATABASE QUERY RESULT: ${user ? JSON.stringify({ id: user.id, email: user.email, accountId: user.accountId }) : "NO USER FOUND"}`);

  if (!user) {
    console.log(`=== SLACK USER RESOLVER END (no user in DB) ===`);
    return null;
  }

  if (user.accountId !== accountId) {
    console.log(`ACCOUNT MISMATCH - user account: ${user.accountId}, slack connection account: ${accountId}`);
    console.log(`=== SLACK USER RESOLVER END (account mismatch) ===`);
    return null;
  }

  console.log(`USER RESOLVED SUCCESSFULLY - userId: ${user.id}, accountId: ${user.accountId}`);
  console.log(`=== SLACK USER RESOLVER END (success) ===`);
  return {
    userId: user.id,
    accountId: user.accountId,
  };
}
