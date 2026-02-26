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

    const { loginUrl, consumerKey, consumerSecret } =
      req.body as {
        loginUrl?: string;
        consumerKey?: string;
        consumerSecret?: string;
      };

    if (!consumerKey || !consumerSecret) {
      res.status(400).json({
        error:
          "Missing required fields: consumer key and consumer secret",
      });
      return;
    }

    const sfLoginUrl = loginUrl || "https://login.salesforce.com";

    console.log("Attempting SF client credentials login at", sfLoginUrl);

    let result;
    try {
      result = await salesforceService.loginWithClientCredentials({
        consumerKey,
        consumerSecret,
        loginUrl: sfLoginUrl,
      });
    } catch (err) {
      console.error("Salesforce client credentials login failed:", err);
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
      console.log("Updating existing org:", existingOrg.id);
      const updatedOrg = await prisma.org.update({
        where: { id: existingOrg.id },
        data: {
          accessToken: result.accessToken,
          instanceUrl: result.instanceUrl,
          tokenStatus: "valid",
          name: result.orgName,
          type: result.orgType,
          sfLoginUrl: sfLoginUrl,
          sfConsumerKey: consumerKey,
          sfConsumerSecret: consumerSecret,
        },
      });
      const response = toOrgResponse(updatedOrg);
      console.log("Sending update response:", response.id, response.name);
      res.json(response);
      return;
    }

    console.log("Creating new org for account:", account.accountId);
    const org = await prisma.org.create({
      data: {
        accountId: account.accountId,
        name: result.orgName,
        salesforceOrgId: result.salesforceOrgId,
        accessToken: result.accessToken,
        instanceUrl: result.instanceUrl,
        type: result.orgType,
        tokenStatus: "valid",
        sfLoginUrl: sfLoginUrl,
        sfConsumerKey: consumerKey,
        sfConsumerSecret: consumerSecret,
      },
    });

    const response = toOrgResponse(org);
    console.log("Sending create response:", response.id, response.name);
    res.status(201).json(response);
    } catch (err) {
      console.error("Unhandled error in SF credentials endpoint:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

// POST /api/orgs/:orgId/test — test Salesforce connection
router.post("/:orgId/test", async (req: Request, res: Response) => {
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

  if (!org.sfConsumerKey || !org.sfConsumerSecret) {
    res.status(400).json({ error: "Org is missing credentials" });
    return;
  }

  try {
    const result = await salesforceService.loginWithClientCredentials({
      consumerKey: org.sfConsumerKey,
      consumerSecret: org.sfConsumerSecret,
      loginUrl: org.sfLoginUrl || "https://login.salesforce.com",
    });

    // Update token and instance URL on success
    await prisma.org.update({
      where: { id: org.id },
      data: {
        accessToken: result.accessToken,
        instanceUrl: result.instanceUrl,
        tokenStatus: "valid",
      },
    });

    res.json({ success: true, orgName: result.orgName });
  } catch (err) {
    // Mark as expired on failure
    await prisma.org.update({
      where: { id: org.id },
      data: { tokenStatus: "expired" },
    });

    const message =
      err instanceof Error ? err.message : "Connection test failed";
    res.status(400).json({ error: message });
  }
});

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
