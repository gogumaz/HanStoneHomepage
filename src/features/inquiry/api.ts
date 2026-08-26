import { apiRequest } from '../../lib/api-client';

export type InquiryStatus = 'submitted' | 'in_review' | 'answered' | 'closed';
export type InquiryNotificationJobStatus = 'pending' | 'sending' | 'sent' | 'skipped' | 'error';

export type InquiryNotificationJob = {
  id: string;
  inquiryId: string;
  answerVersion: number;
  status: InquiryNotificationJobStatus;
  attempts: number;
  nextAttemptAt: string;
  completedAt: string | null;
  lastError: string | null;
  manualRetryAvailable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminInquiry = {
  id: string;
  requesterUserId: string;
  category: string;
  title: string;
  content: string;
  status: InquiryStatus;
  answer: string | null;
  answeredById: string | null;
  answeredAt: string | null;
  attachment: {
    id: string;
    originalName: string;
    contentType: string;
    size: number;
    status: 'ready';
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminInquiryFilters = {
  status: InquiryStatus | 'all';
  category: string;
  q: string;
  page: number;
  pageSize: number;
};

export type AdminInquiryList = {
  items: AdminInquiry[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

function queryString(filters: AdminInquiryFilters) {
  const query = new URLSearchParams();
  if (filters.status !== 'all') query.set('status', filters.status);
  if (filters.category) query.set('category', filters.category);
  if (filters.q.trim()) query.set('q', filters.q.trim());
  query.set('page', String(filters.page));
  query.set('pageSize', String(filters.pageSize));
  return query.toString();
}

export function listAdminInquiries(filters: AdminInquiryFilters) {
  return apiRequest<AdminInquiryList>(`/admin/inquiries?${queryString(filters)}`);
}

export function getAdminInquiry(inquiryId: string) {
  return apiRequest<{ inquiry: AdminInquiry }>(`/admin/inquiries/${encodeURIComponent(inquiryId)}`);
}

export function answerAdminInquiry(inquiryId: string, answer: string) {
  return apiRequest<{ inquiry: AdminInquiry }>(
    `/admin/inquiries/${encodeURIComponent(inquiryId)}/answer`,
    { method: 'POST', body: JSON.stringify({ answer }) },
  );
}

export function updateAdminInquiryStatus(inquiryId: string, status: InquiryStatus) {
  return apiRequest<{ inquiry: AdminInquiry }>(
    `/admin/inquiries/${encodeURIComponent(inquiryId)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
}

export function listAdminInquiryNotificationJobs(inquiryId: string) {
  return apiRequest<{ items: InquiryNotificationJob[] }>(
    `/admin/inquiries/${encodeURIComponent(inquiryId)}/notification-jobs`,
  );
}

export function retryAdminInquiryNotificationJob(jobId: string) {
  return apiRequest<{ job: InquiryNotificationJob }>(
    `/admin/inquiry-notification-jobs/${encodeURIComponent(jobId)}/retry`,
    { method: 'POST' },
  );
}

export function adminInquiryAttachmentUrl(inquiryId: string) {
  const base = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
  return `${base}/admin/inquiries/${encodeURIComponent(inquiryId)}/attachment`;
}
