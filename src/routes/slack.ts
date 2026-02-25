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

// POST /api/slack/connect/callback — handle Slack OAuth callback
router.post("/connect/callback", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const { code } = req.body as { code?: string };

  if (!code) {
    res.status(400).json({ error: "Missing code parameter" });
    return;
  }

  let tokens;
  try {
    tokens = await slackService.exchangeCodeForTokens(code);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Slack OAuth failed";
    res.status(400).json({ error: message });
    return;
  }

  // Upsert: update if workspace already connected, create otherwise
  const existing = await prisma.slackConnection.findFirst({
    where: {
      accountId: account.accountId,
      workspaceId: tokens.workspaceId,
    },
  });

  if (existing) {
    const updated = await prisma.slackConnection.update({
      where: { id: existing.id },
      data: {
        accessToken: tokens.accessToken,
        workspaceName: tokens.workspaceName,
        botUserId: tokens.botUserId,
      },
    });
    res.json({
      connected: true,
      workspaceId: updated.workspaceId,
      workspaceName: updated.workspaceName,
    });
    return;
  }

  const connection = await prisma.slackConnection.create({
    data: {
      accountId: account.accountId,
      workspaceId: tokens.workspaceId,
      workspaceName: tokens.workspaceName,
      accessToken: tokens.accessToken,
      botUserId: tokens.botUserId,
    },
  });

  res.status(201).json({
    connected: true,
    workspaceId: connection.workspaceId,
    workspaceName: connection.workspaceName,
  });
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
