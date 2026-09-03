import { apiRequest } from '../../lib/api-client';

export type GuardianInvitation = {
  id: string;
  student: { id: string; displayName: string };
  inviteeEmail: string;
  status: 'pending';
  expiresAt: string;
  consent: {
    policyVersion: string;
    scopes: string[];
    requiresChildAccountConsent: boolean;
    paidSubscriptionConsentAvailable: boolean;
  };
};

export type GuardianLink = {
  id: string;
  student: { id: string; displayName: string };
  status: 'active' | 'revoked';
  consentedAt: string | null;
};

export type GuardianStudentReport = {
  student: { id: string; displayName: string };
  generatedAt: string;
  summary: {
    totalLessons: number;
    startedLessons: number;
    completedLessons: number;
    completionRate: number;
    completedSteps: number;
    totalSteps: number;
    stepCompletionRate: number;
    lastActivityAt: string | null;
    weekly: {
      periodStart: string;
      periodEnd: string;
      studyDays: number;
      firstAttemptCorrectMissions: number;
      firstAttemptMissions: number;
      firstAttemptAccuracy: number;
    };
  };
  items: Array<{
    lesson: {
      id: string;
      era: { id: string; name: string };
      order: number;
      course: string;
      title: string;
      durationMinutes: number;
    };
    progress: {
      status: 'not_started' | 'in_progress' | 'completed';
      completedSteps: number;
      totalSteps: number;
      lastPositionSeconds: number;
      startedAt: string | null;
      completedAt: string | null;
      lastActivityAt: string | null;
    };
  }>;
};

export function createGuardianInvitation(email: string) {
  return apiRequest<{ invitation: GuardianInvitation; developmentToken?: string }>(
    '/me/guardian-invitations',
    { method: 'POST', body: JSON.stringify({ email }) },
  );
}

export function getGuardianInvitation(token: string) {
  return apiRequest<GuardianInvitation>(`/guardian-invitations/${encodeURIComponent(token)}`);
}

export function acceptGuardianInvitation(
  token: string,
  policyVersion: string,
  scopes: string[],
  paidSubscriptionConsent: boolean,
) {
  return apiRequest<{ link: GuardianLink }>(
    `/guardian-invitations/${encodeURIComponent(token)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify({
        consent: true,
        policyVersion,
        scopes,
        paidSubscriptionConsent,
      }),
    },
  );
}

export function listGuardianStudents() {
  return apiRequest<{ students: GuardianLink[] }>('/guardians/me/students');
}

export function getGuardianStudentReport(studentId: string) {
  return apiRequest<GuardianStudentReport>(
    `/guardians/me/students/${encodeURIComponent(studentId)}/report`,
  );
}

export function revokeGuardianLink(linkId: string) {
  return apiRequest<{ link: GuardianLink }>(
    `/me/guardian-links/${encodeURIComponent(linkId)}/revoke`,
    { method: 'POST' },
  );
}
