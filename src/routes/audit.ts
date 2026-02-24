import { Router } from "express";

const router = Router();

// GET /api/audit — audit log (filterable)
router.get("/", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

export default router;
