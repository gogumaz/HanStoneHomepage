import { apiRequest } from '../../lib/api-client';

export type OrganizationAdminContext = {
  items: Array<{
    membershipId: string;
    organization: { id: string; name: string };
    membership: { startsAt: string; endsAt: string | null };
    permissions: {
      license: readonly ['read', 'manage'];
      seats: readonly ['read', 'manage'];
      refunds: readonly ['read', 'request'];
    };
  }>;
  paymentExecutionRoles: readonly ['operator', 'admin'];
};

export function getOrganizationAdminContext(): Promise<OrganizationAdminContext> {
  return apiRequest('/organization-admin/organizations');
}
