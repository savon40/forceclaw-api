import { Router } from "express";

const router = Router();

// GET /api/orgs — list orgs for current user's account
router.get("/", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// POST /api/orgs/connect/salesforce — initiate Salesforce OAuth
router.post("/connect/salesforce", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// POST /api/orgs/connect/salesforce/callback — handle OAuth callback
router.post("/connect/salesforce/callback", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// DELETE /api/orgs/:orgId — disconnect org
router.delete("/:orgId", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

export default router;
