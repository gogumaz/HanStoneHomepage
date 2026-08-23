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
};

export type AuthResult = {
  user: CurrentUser;
  sessionToken: string;
  expiresAt: Date;
};

export type SignupResult = AuthResult & {
  developmentVerificationToken?: string;
};
