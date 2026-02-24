import { Queue } from "bullmq";
import { redisConnection } from "./redis";

export const agentJobQueue = new Queue("agent-jobs", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
