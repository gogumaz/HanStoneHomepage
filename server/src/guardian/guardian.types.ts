export const GUARDIAN_CONSENT_POLICY_VERSION = "guardian-link-v1";
export const GUARDIAN_CONSENT_SCOPES = [
  "learning_progress",
  "learning_reports",
] as const;

export type GuardianInvitationView = {
  id: string;
  student: { id: string; displayName: string };
  inviteeEmail: string;
  status: "pending";
  expiresAt: Date;
  consent: {
    policyVersion: typeof GUARDIAN_CONSENT_POLICY_VERSION;
    scopes: string[];
  };
};

export type GuardianLinkView = {
  id: string;
  student: { id: string; displayName: string };
  status: "active" | "revoked";
  consentedAt: Date | null;
};
