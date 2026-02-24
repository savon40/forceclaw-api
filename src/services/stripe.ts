export class StripeService {
  async getSubscription(
    _accountId: string
  ): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async getInvoices(
    _accountId: string
  ): Promise<unknown[]> {
    throw new Error("Not implemented");
  }

  async createPortalSession(
    _accountId: string
  ): Promise<{ url: string }> {
    throw new Error("Not implemented");
  }
}

export const stripeService = new StripeService();
