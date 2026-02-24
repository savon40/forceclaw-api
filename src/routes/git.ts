import { Router, Request, Response } from "express";
import { resolveAccount } from "../lib/resolveAccount";
import { gitService } from "../services/git";

const router = Router();

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
