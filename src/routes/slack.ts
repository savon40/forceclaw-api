import { Router } from "express";

const router = Router();

// GET /api/slack/status — Slack connection status
router.get("/status", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// POST /api/slack/connect — initiate Slack OAuth
router.post("/connect", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// DELETE /api/slack/disconnect — disconnect workspace
router.delete("/disconnect", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

export default router;
