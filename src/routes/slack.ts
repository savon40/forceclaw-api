import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { resolveAccount } from "../lib/resolveAccount";
import { slackService } from "../services/slack";

const router = Router();

// GET /api/slack/status — Slack connection status
router.get("/status", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const connection = await prisma.slackConnection.findFirst({
    where: { accountId: account.accountId },
  });

  if (!connection) {
    res.json({ connected: false });
    return;
  }

  res.json({
    connected: true,
    workspaceId: connection.workspaceId,
    workspaceName: connection.workspaceName,
    channels: connection.channels,
    connectedAt: connection.createdAt.toISOString(),
  });
});

// POST /api/slack/connect — initiate Slack OAuth
router.post("/connect", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const authorizationUrl = await slackService.buildAuthorizationUrl(
    account.accountId
  );

  res.json({ authorizationUrl });
});

// DELETE /api/slack/disconnect — disconnect workspace
router.delete("/disconnect", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const connection = await prisma.slackConnection.findFirst({
    where: { accountId: account.accountId },
  });

  if (!connection) {
    res.status(404).json({ error: "No Slack connection found" });
    return;
  }

  await prisma.slackConnection.delete({ where: { id: connection.id } });

  res.json({ success: true });
});

export default router;
