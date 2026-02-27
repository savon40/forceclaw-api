import { Queue } from "bullmq";
import { getRedisConnection } from "./redis";

let _queue: Queue | null = null;

export function getAgentJobQueue(): Queue {
  if (!_queue) {
    _queue = new Queue("agent-jobs", {
      connection: getRedisConnection(),
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
  }
  return _queue;
}
