import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import orgsRouter from "./routes/orgs";
import jobsRouter from "./routes/jobs";
import gitRouter from "./routes/git";
import auditRouter from "./routes/audit";
import teamRouter from "./routes/team";
import billingRouter from "./routes/billing";
import slackRouter from "./routes/slack";
import slackWebhooksRouter from "./routes/slackWebhooks";
import userRouter from "./routes/user";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(helmet());

// Register webhook routes BEFORE express.json() so raw body is available
app.use("/api/slack", slackWebhooksRouter);

app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check (no auth)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Authenticated API routes
app.use("/api/orgs", requireAuth, orgsRouter);
app.use("/api/jobs", requireAuth, jobsRouter);
app.use("/api/git", requireAuth, gitRouter);
app.use("/api/audit", requireAuth, auditRouter);
app.use("/api/team", requireAuth, teamRouter);
app.use("/api/billing", requireAuth, billingRouter);
app.use("/api/slack", requireAuth, slackRouter);
app.use("/api/user", requireAuth, userRouter);

// Global error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`forceclaw-api listening on port ${PORT}`);

  // Start the BullMQ worker in the same process
  import("./workers/agentWorker.js")
    .then(() => console.log("AGENT WORKER LOADED"))
    .catch((err) => console.error("FAILED TO LOAD AGENT WORKER:", err.message));
});

export default app;
