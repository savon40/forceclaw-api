import "dotenv/config";
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../queue/redis";
import { prisma } from "../lib/prisma";
import { slackService } from "../services/slack";
import { salesforceService } from "../services/salesforce";
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

    console.log(`Job received: ${job.id} — ${data.title}`);
    console.log(`Type: ${data.type}, Org: ${data.orgId}`);

    try {
      // 1. Update job status to "running"
      await prisma.job.update({
        where: { id: data.jobId },
        data: { status: "running" },
      });
      await logToJob(data.jobId, "Job started");

      // 2. Re-authenticate with Salesforce
      const org = await prisma.org.findUnique({
        where: { id: data.orgId },
        select: {
          name: true,
          sfConsumerKey: true,
          sfConsumerSecret: true,
          sfLoginUrl: true,
          accessToken: true,
          instanceUrl: true,
        },
      });

      if (!org) {
        throw new Error(`Org ${data.orgId} not found`);
      }

      // 3. Acknowledge — tell the user we're connected
      await replyToSlack(data, `Connected to *${org.name}*. Processing your request...`);
      await logToJob(data.jobId, `Connected to Salesforce org: ${org.name}`);

      // Re-auth if we have client credentials
      if (org.sfConsumerKey && org.sfConsumerSecret && org.sfLoginUrl) {
        try {
          const result = await salesforceService.loginWithClientCredentials({
            consumerKey: org.sfConsumerKey,
            consumerSecret: org.sfConsumerSecret,
            loginUrl: org.sfLoginUrl,
          });

          // Update stored token
          await prisma.org.update({
            where: { id: data.orgId },
            data: {
              accessToken: result.accessToken,
              instanceUrl: result.instanceUrl,
              tokenStatus: "valid",
              lastActivityAt: new Date(),
            },
          });

          await logToJob(data.jobId, "Salesforce re-authentication successful");
        } catch (authErr) {
          await logToJob(
            data.jobId,
            `Salesforce re-auth failed, using existing token: ${authErr instanceof Error ? authErr.message : "unknown error"}`,
            "warn"
          );
        }
      }

      // 4. Log what the user asked (Phase 1 — no AI execution yet)
      await logToJob(data.jobId, `User request: ${data.description}`);

      // TODO: Phase 2 — Claude AI tool-calling execution goes here

      // 5. Mark job as completed
      const durationMs = Date.now() - startTime;
      await prisma.job.update({
        where: { id: data.jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          durationMs,
        },
      });
      await logToJob(data.jobId, `Job completed in ${durationMs}ms`);

      // 6. Post completion to Slack
      await replyToSlack(
        data,
        `Job complete. Your request has been processed.\n\n_"${data.title}"_`
      );

      console.log(`Job ${job.id} completed in ${durationMs}ms`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error(`Job ${job.id} processing error:`, errorMessage);

      // Update job to failed
      await prisma.job.update({
        where: { id: data.jobId },
        data: {
          status: "failed",
          durationMs: Date.now() - startTime,
        },
      });
      await logToJob(data.jobId, `Job failed: ${errorMessage}`, "error");

      // Notify in Slack
      await replyToSlack(
        data,
        `Something went wrong while processing your request. Our team has been notified.\n\nError: ${errorMessage}`
      );

      throw err; // Re-throw so BullMQ handles retries
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: 5,
  }
);

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`Job ${job.id} finished successfully`);
});

console.log("Agent worker started, waiting for jobs...");
