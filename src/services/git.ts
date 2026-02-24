import { prisma } from "../lib/prisma";

interface Branch {
  name: string;
  orgId: string;
  lastCommitAt: string | null;
  jobId: string | null;
}

export class GitService {
  async listBranches(
    accountId: string,
    orgId?: string
  ): Promise<Branch[]> {
    const where: Record<string, unknown> = {
      accountId,
      branchName: { not: null },
    };
    if (orgId) where.orgId = orgId;

    const jobs = await prisma.job.findMany({
      where,
      select: {
        id: true,
        orgId: true,
        branchName: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      distinct: ["branchName"],
    });

    return jobs
      .filter((j) => j.branchName)
      .map((j) => ({
        name: j.branchName!,
        orgId: j.orgId,
        lastCommitAt: j.updatedAt.toISOString(),
        jobId: j.id,
      }));
  }

  async deleteBranch(
    _accountId: string,
    _orgId: string,
    _branchName: string
  ): Promise<void> {
    // TODO: Integrate with actual git provider API to delete remote branch
    throw new Error("Git branch deletion not yet implemented");
  }

  async getCommitHistory(
    _accountId: string,
    _branchName: string
  ): Promise<unknown[]> {
    throw new Error("Not implemented");
  }
}

export const gitService = new GitService();
