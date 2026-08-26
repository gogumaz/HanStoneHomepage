import { apiRequest } from '../../lib/api-client';

export type ConsultationStatus = 'submitted' | 'in_review' | 'contacted' | 'closed';

export type AdminConsultation = {
  id: string;
  requesterUserId: string | null;
  category: string;
  organizationName: string;
  contactName: string;
  phone: string;
  email: string | null;
  expectedStudents: number;
  title: string;
  content: string;
  privacyConsentVersion: string;
  privacyConsentedAt: string;
  status: ConsultationStatus;
  createdAt: string;
  updatedAt: string;
};

export type AdminConsultationFilters = {
  status: ConsultationStatus | 'all';
  category: string;
  q: string;
  page: number;
  pageSize: number;
};

export type AdminConsultationList = {
  items: AdminConsultation[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: Record<ConsultationStatus | 'total', number>;
};

function queryString(filters: AdminConsultationFilters) {
  const query = new URLSearchParams();
  if (filters.status !== 'all') query.set('status', filters.status);
  if (filters.category) query.set('category', filters.category);
  if (filters.q.trim()) query.set('q', filters.q.trim());
  query.set('page', String(filters.page));
  query.set('pageSize', String(filters.pageSize));
  return query.toString();
}

export function listAdminConsultations(filters: AdminConsultationFilters) {
  return apiRequest<AdminConsultationList>(`/admin/consultations?${queryString(filters)}`);
}

export function getAdminConsultation(consultationId: string) {
  return apiRequest<{ consultation: AdminConsultation }>(
    `/admin/consultations/${encodeURIComponent(consultationId)}`,
  );
}

export function updateAdminConsultationStatus(
  consultationId: string,
  status: ConsultationStatus,
) {
  return apiRequest<{ consultation: AdminConsultation }>(
    `/admin/consultations/${encodeURIComponent(consultationId)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
}
