import { Router } from "express";

const router = Router();

// GET /api/jobs — list jobs (filterable)
router.get("/", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// GET /api/jobs/:jobId — job detail
router.get("/:jobId", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// POST /api/jobs/:jobId/respond — send user response to paused job
router.post("/:jobId/respond", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// POST /api/jobs/:jobId/retry — retry failed job
router.post("/:jobId/retry", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

export default router;
