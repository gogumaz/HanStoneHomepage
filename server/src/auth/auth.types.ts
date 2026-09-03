export type PublicRole =
  | "student"
  | "guardian"
  | "instructor"
  | "organization_admin"
  | "operator"
  | "admin";

export type CurrentUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  roles: PublicRole[];
  ageBand?: "unknown" | "under_14" | "age_14_to_18" | "adult";
  minorAccountStatus?: "age_declaration_required" | "guardian_consent_pending" | "active" | "not_applicable";
  guardianConsentVerifiedAt?: Date | null;
};

export type AuthResult = {
  user: CurrentUser;
  sessionToken: string;
  expiresAt: Date;
};

export type SignupResult = AuthResult & {
  developmentVerificationToken?: string;
};
