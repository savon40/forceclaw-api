import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

let _redis: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!_redis) {
    _redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      // Heroku Redis uses rediss:// (TLS) — disable cert verification for their self-signed certs
      ...(redisUrl.startsWith("rediss://") && {
        tls: { rejectUnauthorized: false },
      }),
    });

    _redis.on("connect", () => console.log("REDIS CONNECTED"));
    _redis.on("error", (err) => console.error("REDIS ERROR:", err.message));
  }
  return _redis;
}
