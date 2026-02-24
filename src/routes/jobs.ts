import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { resolveAccount } from "../lib/resolveAccount";
import type { Job, JobLog, JobArtifact } from "@prisma/client";

const router = Router();

type JobWithRelations = Job & {
  logs: JobLog[];
  artifacts: JobArtifact[];
  org: { name: string };
};

function toJobResponse(job: JobWithRelations) {
  return {
    id: job.id,
    accountId: job.accountId,
    orgId: job.orgId,
    orgName: job.org.name,
    status: job.status,
    type: job.type,
    title: job.title,
    description: job.description,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    durationMs: job.durationMs,
    branchName: job.branchName,
    prUrl: job.prUrl,
    changeSetName: job.changeSetName,
    pendingQuestion: job.pendingQuestion,
    logs: job.logs.map((log) => ({
      id: log.id,
      jobId: log.jobId,
      level: log.level,
      message: log.message,
      timestamp: log.timestamp.toISOString(),
    })),
    artifacts: job.artifacts.map((a) => ({
      id: a.id,
      jobId: a.jobId,
      type: a.type,
      filename: a.filename,
      commitHash: a.commitHash,
      diffUrl: a.diffUrl,
    })),
  };
}

const jobInclude = {
  logs: { orderBy: { timestamp: "asc" as const } },
  artifacts: true,
  org: { select: { name: true } },
};

// GET /api/jobs — list jobs (filterable)
router.get("/", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const { orgId, status, type, page, limit } = req.query as Record<
    string,
    string | undefined
  >;

  const take = Math.min(Number(limit) || 50, 100);
  const skip = ((Number(page) || 1) - 1) * take;

  const where: Record<string, unknown> = { accountId: account.accountId };
  if (orgId) where.orgId = orgId;
  if (status) where.status = status;
  if (type) where.type = type;

  const jobs = await prisma.job.findMany({
    where,
    include: jobInclude,
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });

  res.json((jobs as JobWithRelations[]).map(toJobResponse));
});

// GET /api/jobs/:jobId — job detail
router.get("/:jobId", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const jobId = req.params.jobId as string;
  const job = await prisma.job.findFirst({
    where: { id: jobId, accountId: account.accountId },
    include: jobInclude,
  });

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(toJobResponse(job as JobWithRelations));
});

// POST /api/jobs/:jobId/respond — send user response to paused job
router.post("/:jobId/respond", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const jobId = req.params.jobId as string;
  const { response } = req.body as { response?: string };

  if (!response) {
    res.status(400).json({ error: "Missing response field" });
    return;
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, accountId: account.accountId },
  });

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "paused" && job.status !== "waiting_for_input") {
    res.status(409).json({ error: "Job is not waiting for input" });
    return;
  }

  await prisma.jobLog.create({
    data: {
      jobId,
      level: "info",
      message: `User responded: ${response}`,
    },
  });

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "running",
      pendingQuestion: null,
    },
    include: jobInclude,
  });

  res.json(toJobResponse(updatedJob as JobWithRelations));
});

// POST /api/jobs/:jobId/retry — retry failed job
router.post("/:jobId/retry", async (req: Request, res: Response) => {
  const account = await resolveAccount(req, res);
  if (!account) return;

  const jobId = req.params.jobId as string;
  const job = await prisma.job.findFirst({
    where: { id: jobId, accountId: account.accountId },
  });

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "failed") {
    res.status(409).json({ error: "Only failed jobs can be retried" });
    return;
  }

  await prisma.jobLog.create({
    data: {
      jobId,
      level: "info",
      message: "Job queued for retry",
    },
  });

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "queued",
      completedAt: null,
      durationMs: null,
      pendingQuestion: null,
    },
    include: jobInclude,
  });

  res.json(toJobResponse(updatedJob as JobWithRelations));
});

export default router;
