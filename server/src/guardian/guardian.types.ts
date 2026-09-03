import { CURRENT_LEGAL_POLICY_VERSION } from "../common/legal-policy.js";

export const GUARDIAN_CONSENT_POLICY_VERSION = CURRENT_LEGAL_POLICY_VERSION;
export const GUARDIAN_CONSENT_SCOPES = [
  "learning_progress",
  "learning_reports",
] as const;
export const CHILD_ACCOUNT_CONSENT_SCOPE = "child_account_creation" as const;
export const PAID_SUBSCRIPTION_CONSENT_SCOPE = "paid_subscription" as const;

export type GuardianInvitationView = {
  id: string;
  student: { id: string; displayName: string };
  inviteeEmail: string;
  status: "pending";
  expiresAt: Date;
  consent: {
    policyVersion: typeof GUARDIAN_CONSENT_POLICY_VERSION;
    scopes: string[];
    requiresChildAccountConsent: boolean;
    paidSubscriptionConsentAvailable: boolean;
  };
};

export type GuardianLinkView = {
  id: string;
  student: { id: string; displayName: string };
  status: "active" | "revoked";
  consentedAt: Date | null;
};
