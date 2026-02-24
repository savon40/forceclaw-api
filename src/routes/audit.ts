import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { resolveAccount } from "../lib/resolveAccount";
import type { AuditLog } from "@prisma/client";

const router = Router();

function toAuditLogResponse(log: AuditLog) {
  return {
    id: log.id,
    accountId: log.accountId,
    userId: log.userId,
    orgId: log.orgId,
    actionType: log.actionType,
    description: log.description,
    metadataChanged: log.metadataChanged,
    gitCommitHash: log.gitCommitHash,
    status: log.status,
    createdAt: log.createdAt.toISOString(),
  };
}

// GET /api/audit — audit log (filterable)
router.get("/", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const { orgId, userId, actionType, page, limit } = req.query as Record<
    string,
    string | undefined
  >;

  const take = Math.min(Number(limit) || 50, 100);
  const skip = ((Number(page) || 1) - 1) * take;

  const where: Record<string, unknown> = { accountId: account.accountId };
  if (orgId) where.orgId = orgId;
  if (userId) where.userId = userId;
  if (actionType) where.actionType = actionType;

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });

  res.json(logs.map(toAuditLogResponse));
});

export default router;
