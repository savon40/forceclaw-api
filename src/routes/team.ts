import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { resolveAccount } from "../lib/resolveAccount";
import type { User, TeamInvite } from "@prisma/client";

const router = Router();

function toTeamMemberResponse(user: User, inviteStatus: "accepted" | "pending" = "accepted") {
  return {
    id: user.id,
    email: user.email,
    fullName: user.name || user.email,
    avatarUrl: null,
    accountId: user.accountId,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    inviteStatus,
  };
}

function toInviteResponse(invite: TeamInvite) {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    invitedBy: invite.invitedBy,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  };
}

// GET /api/team — list team members + pending invites
router.get("/", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const users = await prisma.user.findMany({
    where: { accountId: account.accountId },
    orderBy: { createdAt: "asc" },
  });

  const pendingInvites = await prisma.teamInvite.findMany({
    where: { accountId: account.accountId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    members: users.map((u) => toTeamMemberResponse(u)),
    invites: pendingInvites.map(toInviteResponse),
  });
});

// POST /api/team/invite — invite team member
router.post("/invite", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const { email, role } = req.body as { email?: string; role?: string };

  if (!email) {
    res.status(400).json({ error: "Missing email field" });
    return;
  }

  // Check if user already exists in this account
  const existingUser = await prisma.user.findFirst({
    where: { email, accountId: account.accountId },
  });

  if (existingUser) {
    res.status(409).json({ error: "User is already a team member" });
    return;
  }

  // Check for existing pending invite
  const existingInvite = await prisma.teamInvite.findFirst({
    where: { email, accountId: account.accountId, status: "pending" },
  });

  if (existingInvite) {
    res.status(409).json({ error: "An invite is already pending for this email" });
    return;
  }

  const invite = await prisma.teamInvite.create({
    data: {
      accountId: account.accountId,
      email,
      role: role || "member",
      invitedBy: account.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  res.status(201).json(toInviteResponse(invite));
});

// PATCH /api/team/:userId/role — change role
router.patch("/:userId/role", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const targetUserId = req.params.userId as string;
  const { role } = req.body as { role?: string };

  if (!role || !["admin", "member", "viewer"].includes(role)) {
    res.status(400).json({ error: "Invalid role. Must be admin, member, or viewer" });
    return;
  }

  const targetUser = await prisma.user.findFirst({
    where: { id: targetUserId, accountId: account.accountId },
  });

  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Prevent demoting yourself
  if (targetUserId === account.userId && role !== "admin") {
    res.status(409).json({ error: "Cannot change your own role" });
    return;
  }

  const updatedUser = await prisma.user.update({
    where: { id: targetUserId },
    data: { role },
  });

  res.json(toTeamMemberResponse(updatedUser));
});

// DELETE /api/team/:userId — remove member
router.delete("/:userId", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const targetUserId = req.params.userId as string;

  if (targetUserId === account.userId) {
    res.status(409).json({ error: "Cannot remove yourself from the team" });
    return;
  }

  const targetUser = await prisma.user.findFirst({
    where: { id: targetUserId, accountId: account.accountId },
  });

  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await prisma.user.delete({ where: { id: targetUserId } });

  res.json({ success: true });
});

export default router;
