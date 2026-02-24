export class GitService {
  async listBranches(
    _accountId: string
  ): Promise<unknown[]> {
    throw new Error("Not implemented");
  }

  async deleteBranch(
    _accountId: string,
    _branchName: string
  ): Promise<void> {
    throw new Error("Not implemented");
  }

  async getCommitHistory(
    _accountId: string,
    _branchName: string
  ): Promise<unknown[]> {
    throw new Error("Not implemented");
  }
}

export const gitService = new GitService();
