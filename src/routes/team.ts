import { Router } from "express";

const router = Router();

// GET /api/team — list team members
router.get("/", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// POST /api/team/invite — invite team member
router.post("/invite", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// PATCH /api/team/:userId/role — change role
router.patch("/:userId/role", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// DELETE /api/team/:userId — remove member
router.delete("/:userId", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

export default router;
