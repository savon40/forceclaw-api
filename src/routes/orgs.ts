import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { resolveAccount } from "../lib/resolveAccount";
import { salesforceService } from "../services/salesforce";
import type { Org } from "@prisma/client";

const router = Router();

function toOrgResponse(org: Org) {
  return {
    id: org.id,
    accountId: org.accountId,
    name: org.name,
    salesforceOrgId: org.salesforceOrgId,
    type: org.type,
    isProductionWarning: org.type === "production",
    tokenStatus: org.tokenStatus,
    defaultSandbox: org.defaultSandbox,
    gitRepoUrl: org.gitRepoUrl,
    lastActivityAt: org.lastActivityAt?.toISOString() ?? null,
    connectedAt: org.connectedAt.toISOString(),
  };
}

// GET /api/orgs — list orgs for current user's account
router.get("/", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const orgs = await prisma.org.findMany({
    where: { accountId: account.accountId },
    orderBy: { connectedAt: "desc" },
  });

  res.json(orgs.map(toOrgResponse));
});

// GET /api/orgs/:orgId — single org detail
router.get("/:orgId", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const orgId = req.params.orgId as string;
  const org = await prisma.org.findFirst({
    where: { id: orgId, accountId: account.accountId },
  });

  if (!org) {
    res.status(404).json({ error: "Org not found" });
    return;
  }

  res.json(toOrgResponse(org));
});

// POST /api/orgs/connect/salesforce — initiate Salesforce OAuth
router.post("/connect/salesforce", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const authorizationUrl = salesforceService.buildAuthorizationUrl(
    account.accountId
  );

  res.json({ authorizationUrl });
});

// POST /api/orgs/connect/salesforce/callback — handle OAuth callback
router.post(
  "/connect/salesforce/callback",
  async (req: Request, res: Response) => {
    const { code, state } = req.body as { code?: string; state?: string };

    if (!code || !state) {
      res.status(400).json({ error: "Missing code or state parameter" });
      return;
    }

    // state contains the accountId
    const accountId = state;

    // Verify the requesting user belongs to this account
    const account = await resolveAccount(req, res);
    if (!account) return;

    if (account.accountId !== accountId) {
      res.status(403).json({ error: "Account mismatch" });
      return;
    }

    const tokens = await salesforceService.exchangeCodeForTokens(code);

    // Check if this Salesforce org is already connected
    const existingOrg = await prisma.org.findFirst({
      where: {
        accountId,
        salesforceOrgId: tokens.salesforceOrgId,
      },
    });

    if (existingOrg) {
      // Update existing org with new tokens
      const updatedOrg = await prisma.org.update({
        where: { id: existingOrg.id },
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          instanceUrl: tokens.instanceUrl,
          tokenStatus: "valid",
          name: tokens.orgName,
        },
      });
      res.json(toOrgResponse(updatedOrg));
      return;
    }

    const org = await prisma.org.create({
      data: {
        accountId,
        name: tokens.orgName,
        salesforceOrgId: tokens.salesforceOrgId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        instanceUrl: tokens.instanceUrl,
        type: "sandbox",
        tokenStatus: "valid",
      },
    });

    res.status(201).json(toOrgResponse(org));
  }
);

// POST /api/orgs/connect/salesforce/credentials — connect via username/password
router.post(
  "/connect/salesforce/credentials",
  async (req: Request, res: Response) => {
    try {
    const account = await resolveAccount(req, res);
    if (!account) return;

    const { username, password, securityToken, loginUrl, consumerKey, consumerSecret } =
      req.body as {
        username?: string;
        password?: string;
        securityToken?: string;
        loginUrl?: string;
        consumerKey?: string;
        consumerSecret?: string;
      };

    if (!username || !password || !securityToken || !consumerKey || !consumerSecret) {
      res.status(400).json({
        error:
          "Missing required fields: username, password, security token, consumer key, and consumer secret",
      });
      return;
    }

    const sfLoginUrl = loginUrl || "https://login.salesforce.com";

    console.log("Attempting SF credential login for:", username, "at", sfLoginUrl);

    let result;
    try {
      result = await salesforceService.loginWithCredentials({
        username,
        password,
        securityToken,
        loginUrl: sfLoginUrl,
        consumerKey,
        consumerSecret,
      });
    } catch (err) {
      console.error("Salesforce credential login failed:", err);
      const message =
        err instanceof Error ? err.message : "Salesforce login failed";
      res.status(400).json({ error: message });
      return;
    }

    // Check if this Salesforce org is already connected
    const existingOrg = await prisma.org.findFirst({
      where: {
        accountId: account.accountId,
        salesforceOrgId: result.salesforceOrgId,
      },
    });

    if (existingOrg) {
      const updatedOrg = await prisma.org.update({
        where: { id: existingOrg.id },
        data: {
          accessToken: result.accessToken,
          instanceUrl: result.instanceUrl,
          tokenStatus: "valid",
          name: result.orgName,
          type: result.orgType,
          sfUsername: username,
          sfPassword: password,
          sfSecurityToken: securityToken,
          sfLoginUrl: sfLoginUrl,
          sfConsumerKey: consumerKey,
          sfConsumerSecret: consumerSecret,
        },
      });
      res.json(toOrgResponse(updatedOrg));
      return;
    }

    const org = await prisma.org.create({
      data: {
        accountId: account.accountId,
        name: result.orgName,
        salesforceOrgId: result.salesforceOrgId,
        accessToken: result.accessToken,
        instanceUrl: result.instanceUrl,
        type: result.orgType,
        tokenStatus: "valid",
        sfUsername: username,
        sfPassword: password,
        sfSecurityToken: securityToken,
        sfLoginUrl: sfLoginUrl,
        sfConsumerKey: consumerKey,
        sfConsumerSecret: consumerSecret,
      },
    });

    res.status(201).json(toOrgResponse(org));
    } catch (err) {
      console.error("Unhandled error in SF credentials endpoint:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// DELETE /api/orgs/:orgId — disconnect org
router.delete("/:orgId", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const orgId = req.params.orgId as string;
  const org = await prisma.org.findFirst({
    where: { id: orgId, accountId: account.accountId },
  });

  if (!org) {
    res.status(404).json({ error: "Org not found" });
    return;
  }

  // Check for active jobs before deleting
  const activeJobs = await prisma.job.count({
    where: {
      orgId: org.id,
      status: { in: ["queued", "running"] },
    },
  });

  if (activeJobs > 0) {
    res
      .status(409)
      .json({ error: "Cannot disconnect org with active jobs" });
    return;
  }

  // Delete related jobs and their logs/artifacts first, then the org
  const jobIds = await prisma.job.findMany({
    where: { orgId: org.id },
    select: { id: true },
  });

  if (jobIds.length > 0) {
    const ids = jobIds.map((j) => j.id);
    await prisma.jobLog.deleteMany({ where: { jobId: { in: ids } } });
    await prisma.jobArtifact.deleteMany({ where: { jobId: { in: ids } } });
    await prisma.job.deleteMany({ where: { orgId: org.id } });
  }

  await prisma.org.delete({ where: { id: org.id } });

  res.json({ success: true });
});

export default router;
