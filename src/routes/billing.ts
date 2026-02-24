import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { resolveAccount } from "../lib/resolveAccount";
import { stripeService } from "../services/stripe";

const router = Router();

const PLAN_LIMITS: Record<string, { tasks: number; orgs: number }> = {
  starter: { tasks: 50, orgs: 2 },
  team: { tasks: 500, orgs: 10 },
  enterprise: { tasks: -1, orgs: -1 }, // unlimited
};

// GET /api/billing/subscription — current plan + usage
router.get("/subscription", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const dbAccount = await prisma.account.findUnique({
    where: { id: account.accountId },
  });

  if (!dbAccount) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const plan = dbAccount.plan as string;
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

  // Count current usage
  const [orgsConnected, tasksUsed] = await Promise.all([
    prisma.org.count({ where: { accountId: account.accountId } }),
    prisma.job.count({
      where: {
        accountId: account.accountId,
        createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    }),
  ]);

  res.json({
    id: dbAccount.id,
    accountId: dbAccount.id,
    plan,
    status: "active",
    currentPeriodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    currentPeriodEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
    tasksUsed,
    tasksLimit: limits.tasks,
    orgsConnected,
    orgsLimit: limits.orgs,
  });
});

// GET /api/billing/invoices — billing history
router.get("/invoices", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const invoices = await stripeService.getInvoices(account.accountId);
  res.json(invoices);
});

// POST /api/billing/portal — create Stripe portal session (returns URL)
router.post("/portal", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const session = await stripeService.createPortalSession(account.accountId);
  res.json(session);
});

export default router;
