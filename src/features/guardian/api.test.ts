import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptGuardianInvitation } from './api';

describe('guardian API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits the policy version advertised by the invitation response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { link: { id: 'link-1', status: 'active' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await acceptGuardianInvitation(
      'invite/token',
      'guardian-link-v2',
      ['learning_progress', 'learning_reports'],
      true,
    );

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/guardian-invitations/invite%2Ftoken/accept',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(JSON.parse(request.body as string)).toEqual({
      consent: true,
      policyVersion: 'guardian-link-v2',
      scopes: ['learning_progress', 'learning_reports'],
      paidSubscriptionConsent: true,
    });
  });
});
