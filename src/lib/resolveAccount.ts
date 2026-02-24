import { Request, Response } from "express";
import { prisma } from "./prisma";

interface ResolvedAccount {
  userId: string;
  accountId: string;
}

export async function resolveAccount(
  req: Request,
  res: Response
): Promise<ResolvedAccount | null> {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, accountId: true },
  });

  if (!user) {
    res.status(403).json({ error: "User not found in database" });
    return null;
  }

  return { userId: user.id, accountId: user.accountId };
}
