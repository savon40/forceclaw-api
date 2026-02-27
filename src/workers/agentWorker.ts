import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../queue/redis";
import { prisma } from "../lib/prisma";
import { slackService } from "../services/slack";
import { runAgentLoop } from "../agent/loop";
import type { AgentJobPayload } from "../queue/jobs/agentJob";

async function logToJob(jobId: string, message: string, level = "info") {
  await prisma.jobLog.create({
    data: { jobId, message, level },
  });
}

async function replyToSlack(data: AgentJobPayload, text: string) {
  if (data.slackAccessToken && data.slackChannel && data.slackThreadTs) {
    await slackService.postThreadReply(
      data.slackAccessToken,
      data.slackChannel,
      data.slackThreadTs,
      text
    );
  }
}

const worker = new Worker<AgentJobPayload>(
  "agent-jobs",
  async (job: Job<AgentJobPayload>) => {
    const { data } = job;
    const startTime = Date.now();

    console.log(`\n========================================`);
    console.log(`=== WORKER JOB RECEIVED: ${job.id} ===`);
    console.log(`TYPE: ${data.type}, ORG: ${data.orgId}`);
    console.log(`TITLE: ${data.title}`);
    console.log(`========================================\n`);

    try {
      await logToJob(data.jobId, "Job picked up by worker");

      // Run the full Claude agent loop
      // (handles SF connection, org context, Claude conversation, and Slack replies)
      await runAgentLoop({
        accountId: data.accountId,
        orgId: data.orgId,
        userId: data.userId,
        messageText: data.description,
        channel: data.slackChannel || "",
        threadTs: data.slackThreadTs || "",
        accessToken: data.slackAccessToken || "",
      });

      const durationMs = Date.now() - startTime;
      await logToJob(data.jobId, `Job completed in ${durationMs}ms`);
      console.log(`=== WORKER JOB COMPLETE: ${job.id} (${durationMs}ms) ===\n`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error(`=== WORKER JOB FAILED: ${job.id} ===`);
      console.error(`ERROR: ${errorMessage}`);

      const durationMs = Date.now() - startTime;

      // Update job to failed
      await prisma.job.update({
        where: { id: data.jobId },
        data: {
          status: "failed",
          durationMs,
        },
      });
      await logToJob(data.jobId, `Job failed: ${errorMessage}`, "error");

      // Notify in Slack
      await replyToSlack(
        data,
        `Sorry, I ran into an error processing your request: ${errorMessage}`
      );

      throw err; // Re-throw so BullMQ handles retries
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: 3,
  }
);

worker.on("failed", (job, err) => {
  console.error(`WORKER JOB ${job?.id} FAILED PERMANENTLY:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`WORKER JOB ${job.id} FINISHED SUCCESSFULLY`);
});

console.log("=== AGENT WORKER STARTED — WAITING FOR JOBS ===");

export { worker };
