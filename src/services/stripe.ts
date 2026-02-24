import { prisma } from "../lib/prisma";

interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: string;
  pdfUrl: string;
}

export class StripeService {
  private get stripeKey(): string {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    return key;
  }

  async getInvoices(accountId: string): Promise<Invoice[]> {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account || account.plan === "starter") {
      return []; // Free plan has no invoices
    }

    // TODO: Fetch from Stripe API using the account's Stripe customer ID
    // const stripe = new Stripe(this.stripeKey);
    // const invoices = await stripe.invoices.list({ customer: account.stripeCustomerId });
    return [];
  }

  async createPortalSession(
    accountId: string
  ): Promise<{ url: string }> {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new Error("Account not found");
    }

    // TODO: Create Stripe billing portal session
    // const stripe = new Stripe(this.stripeKey);
    // const session = await stripe.billingPortal.sessions.create({
    //   customer: account.stripeCustomerId,
    //   return_url: `${process.env.FRONTEND_URL}/settings/billing`,
    // });
    // return { url: session.url };

    throw new Error(
      "Stripe billing portal not yet configured. Set STRIPE_SECRET_KEY and add stripeCustomerId to Account model."
    );
  }
}

export const stripeService = new StripeService();
