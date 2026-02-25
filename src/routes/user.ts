import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { resolveAccount } from "../lib/resolveAccount";

const router = Router();

// GET /api/user/me — return current user, auto-provisioning if needed
router.get("/me", async (req: Request, res: Response) => {
  const authUser = req.user;
  if (!authUser?.id || !authUser.email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    let user = await prisma.user.findUnique({
      where: { id: authUser.id },
    });

    if (!user) {
      // Auto-provision: create Account + User in a transaction
      const emailPrefix = authUser.email.split("@")[0];
      const domain = authUser.email.split("@")[1];
      const accountName = domain ? domain.split(".")[0] : emailPrefix;

      user = await prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: { name: accountName },
        });

        return tx.user.create({
          data: {
            id: authUser.id,
            email: authUser.email!,
            role: "admin",
            accountId: account.id,
          },
        });
      });
    }

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.name ?? user.email,
      avatarUrl: null,
      accountId: user.accountId,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("Error in GET /api/user/me:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/user/setup-status — check onboarding completion
router.get("/setup-status", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  try {
    // Check Salesforce: org with valid credentials
    const sfOrg = await prisma.org.findFirst({
      where: {
        accountId: account.accountId,
        sfUsername: { not: null },
        tokenStatus: "valid",
      },
      select: {
        id: true,
        name: true,
        salesforceOrgId: true,
        gitRepoUrl: true,
        gitAccessToken: true,
        gitProvider: true,
      },
    });

    const salesforce = sfOrg
      ? { connected: true, orgId: sfOrg.id, orgName: sfOrg.name }
      : { connected: false };

    // Check GitHub: org has git configured
    const github =
      sfOrg?.gitRepoUrl && sfOrg?.gitAccessToken
        ? { connected: true, repoUrl: sfOrg.gitRepoUrl }
        : { connected: false };

    // Check Slack: account has a connection
    const slackConn = await prisma.slackConnection.findFirst({
      where: { accountId: account.accountId },
      select: { workspaceName: true },
    });

    const slack = slackConn
      ? { connected: true, workspaceName: slackConn.workspaceName }
      : { connected: false };

    // Setup is complete when Salesforce and Slack are connected.
    // GitHub is optional and can be configured later.
    const setupComplete = salesforce.connected && slack.connected;

    res.json({
      setupComplete,
      steps: { salesforce, github, slack },
    });
  } catch (err) {
    console.error("Error in GET /api/user/setup-status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
