export type UserRole =
  | 'student'
  | 'guardian'
  | 'instructor'
  | 'organization_admin'
  | 'operator'
  | 'admin';

export type CurrentUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  roles: UserRole[];
  ageBand?: 'unknown' | 'under_14' | 'age_14_to_18' | 'adult';
  minorAccountStatus?: 'age_declaration_required' | 'guardian_consent_pending' | 'active' | 'not_applicable';
  guardianConsentVerifiedAt?: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const result = await apiRequest<{ user: CurrentUser }>('/me');
    return result.user;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

export type AuthResponse = {
  user: CurrentUser;
  developmentVerificationToken?: string;
};

export type OAuthProviderName = 'naver' | 'kakao' | 'google';

export type OAuthAccounts = {
  items: Array<{
    provider: OAuthProviderName;
    email: string | null;
    createdAt: string;
  }>;
  hasPassword: boolean;
};

export function oauthStartUrl(provider: OAuthProviderName, returnTo = '/account'): string {
  const apiBaseUrl = (window.APP_CONFIG?.apiBaseUrl || '/api/v1').replace(/\/$/, '');
  return `${apiBaseUrl}/auth/oauth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function oauthLinkStartUrl(provider: OAuthProviderName): string {
  const apiBaseUrl = (window.APP_CONFIG?.apiBaseUrl || '/api/v1').replace(/\/$/, '');
  const returnTo = `/account?oauthLinked=${encodeURIComponent(provider)}`;
  return `${apiBaseUrl}/me/oauth-accounts/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function listOAuthAccounts(): Promise<OAuthAccounts> {
  return apiRequest('/me/oauth-accounts');
}

export function unlinkOAuthAccount(provider: OAuthProviderName): Promise<{ unlinked: true; provider: OAuthProviderName }> {
  return apiRequest(`/me/oauth-accounts/${provider}`, { method: 'DELETE' });
}

export function oauthAccountDeletionStartUrl(provider: OAuthProviderName): string {
  const apiBaseUrl = (window.APP_CONFIG?.apiBaseUrl || '/api/v1').replace(/\/$/, '');
  const returnTo = '/account?accountDeleted=1';
  return `${apiBaseUrl}/me/account-deletion/oauth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function deleteAccount(input: { confirmation: string; password: string }): Promise<{ deleted: true }> {
  return apiRequest('/me', { method: 'DELETE', body: JSON.stringify(input) });
}

export async function login(input: { email: string; password: string }): Promise<AuthResponse> {
  const result = await apiRequest<{ user: CurrentUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result;
}

export async function signup(input: {
  email: string;
  password: string;
  displayName: string;
  role: 'student' | 'guardian';
  ageBand: 'under_14' | 'age_14_to_18' | 'adult';
}): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function declareAgeBand(ageBand: 'under_14' | 'age_14_to_18' | 'adult') {
  return apiRequest<{ user: CurrentUser }>('/me/age-band', {
    method: 'PATCH',
    body: JSON.stringify({ ageBand }),
  });
}

export async function logout(): Promise<void> {
  await apiRequest<{ loggedOut: true }>('/auth/logout', { method: 'POST' });
}

export async function requestPasswordReset(email: string): Promise<{
  accepted: true;
  developmentToken?: string;
}> {
  return apiRequest('/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function confirmPasswordReset(input: { token: string; password: string }): Promise<void> {
  await apiRequest<{ reset: true }>('/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function requestEmailVerification(): Promise<{
  accepted: true;
  alreadyVerified: boolean;
  developmentToken?: string;
}> {
  return apiRequest('/auth/email-verification/request', { method: 'POST' });
}

export async function confirmEmailVerification(token: string): Promise<void> {
  await apiRequest<{ verified: true; verifiedAt: string }>('/auth/email-verification/confirm', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}
import { ApiClientError, apiRequest } from '../../lib/api-client';
