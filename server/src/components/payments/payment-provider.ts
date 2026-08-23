export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export type PaymentStatus = "ready" | "paid" | "cancelled" | "failed";

export type PaymentRecord = {
  provider: string;
  paymentId: string;
  orderId: string;
  status: PaymentStatus;
  amount: number;
  method: string | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  cancelAmount: number;
};

export type CancelPaymentInput = {
  paymentId: string;
  amount: number;
  checksum: number;
  reason: string;
};

export interface PaymentProvider {
  readonly providerId: string;
  getPayment(paymentId: string): Promise<PaymentRecord>;
  cancelPayment(input: CancelPaymentInput): Promise<PaymentRecord>;
}

export class PaymentComponentError extends Error {
  constructor(
    public readonly code: "NOT_CONFIGURED" | "PROVIDER_ERROR" | "INVALID_RESPONSE",
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PaymentComponentError";
  }
}
