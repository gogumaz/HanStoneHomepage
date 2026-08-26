import {
  OAuthClient,
  OAuthComponentModule,
  type OAuthComponentOptions,
  type OAuthIdentity,
} from "@baduk-history/integration-components/oauth";
import {
  PAYMENT_PROVIDER,
  PaymentComponentModule,
  type PaymentProvider,
  type PaymentRecord,
} from "@baduk-history/integration-components/payments";

const oauthOptions = {
  providers: {
    google: {
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://app.example.com/oauth/callback",
    },
  },
} satisfies OAuthComponentOptions;

const oauthModule = OAuthComponentModule.register(oauthOptions);
const oauthClientType: typeof OAuthClient = OAuthClient;

const paymentProvider: PaymentProvider = {
  providerId: "consumer-smoke",
  async getPayment(paymentId): Promise<PaymentRecord> {
    return {
      provider: this.providerId,
      paymentId,
      orderId: "order-id",
      status: "paid",
      amount: 1000,
      method: null,
      paidAt: new Date(),
      cancelledAt: null,
      cancelAmount: 0,
    };
  },
  async cancelPayment(input) {
    return this.getPayment(input.paymentId);
  },
};

const paymentModule = PaymentComponentModule.register({
  provider: "toss-payments",
  tossPayments: {
    secretKey: null,
  },
});

const identity: OAuthIdentity | null = null;

void [oauthModule, oauthClientType, PAYMENT_PROVIDER, paymentProvider, paymentModule, identity];
