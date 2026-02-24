import { Router } from "express";

const router = Router();

// GET /api/billing/subscription — current plan + usage
router.get("/subscription", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// GET /api/billing/invoices — billing history
router.get("/invoices", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

// POST /api/billing/portal — create Stripe portal session (returns URL)
router.post("/portal", (_req, res) => {
  res.status(501).json({ message: "Not implemented" });
});

export default router;
