import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { resolveAccount } from "../lib/resolveAccount";
import { gitService } from "../services/git";

const router = Router();

// POST /api/git/connect — connect GitHub PAT + repo to an org
router.post("/connect", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const { orgId, accessToken, repoUrl } = req.body as {
    orgId?: string;
    accessToken?: string;
    repoUrl?: string;
  };

  if (!orgId || !accessToken || !repoUrl) {
    res.status(400).json({ error: "Missing orgId, accessToken, or repoUrl" });
    return;
  }

  // Verify org belongs to account
  const org = await prisma.org.findFirst({
    where: { id: orgId, accountId: account.accountId },
  });

  if (!org) {
    res.status(404).json({ error: "Org not found" });
    return;
  }

  // Parse owner/repo from URL (supports https://github.com/owner/repo and owner/repo)
  const repoMatch = repoUrl.match(
    /(?:https?:\/\/github\.com\/)?([^/]+)\/([^/]+?)(?:\.git)?$/
  );

  if (!repoMatch) {
    res.status(400).json({ error: "Invalid repository URL format" });
    return;
  }

  const [, owner, repo] = repoMatch;

  // Validate PAT against GitHub API
  try {
    const ghResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!ghResponse.ok) {
      const errorBody = await ghResponse.text();
      res.status(400).json({
        error:
          ghResponse.status === 401
            ? "Invalid GitHub access token"
            : ghResponse.status === 404
              ? "Repository not found or token lacks access"
              : `GitHub API error: ${errorBody}`,
      });
      return;
    }
  } catch {
    res.status(400).json({ error: "Failed to connect to GitHub" });
    return;
  }

  // Update org with git info
  const updatedOrg = await prisma.org.update({
    where: { id: orgId },
    data: {
      gitAccessToken: accessToken,
      gitRepoUrl: `https://github.com/${owner}/${repo}`,
      gitProvider: "github",
    },
  });

  res.json({
    connected: true,
    repoUrl: updatedOrg.gitRepoUrl,
    provider: updatedOrg.gitProvider,
  });
});

// GET /api/git/status — check git connection status for an org
router.get("/status", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const { orgId } = req.query as { orgId?: string };

  if (!orgId) {
    res.status(400).json({ error: "Missing orgId query parameter" });
    return;
  }

  const org = await prisma.org.findFirst({
    where: { id: orgId, accountId: account.accountId },
    select: { gitRepoUrl: true, gitProvider: true, gitAccessToken: true },
  });

  if (!org) {
    res.status(404).json({ error: "Org not found" });
    return;
  }

  res.json({
    connected: !!(org.gitRepoUrl && org.gitAccessToken),
    repoUrl: org.gitRepoUrl,
    provider: org.gitProvider,
  });
});

// GET /api/git/branches — list open branches
router.get("/branches", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const { orgId } = req.query as { orgId?: string };
  const branches = await gitService.listBranches(account.accountId, orgId);

  res.json(branches);
});

// DELETE /api/git/branches/:branchName — delete a branch
router.delete("/branches/:branchName", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const branchName = req.params.branchName as string;
  const { orgId } = req.body as { orgId?: string };

  if (!orgId) {
    res.status(400).json({ error: "Missing orgId field" });
    return;
  }

  await gitService.deleteBranch(account.accountId, orgId, branchName);

  res.json({ success: true });
});

export default router;
