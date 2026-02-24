import { Router } from "express";

const router = Router();

// GET /api/git/branches — list open branches
router.get("/branches", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// DELETE /api/git/branches/:branchName — delete a branch
router.delete("/branches/:branchName", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

export default router;
