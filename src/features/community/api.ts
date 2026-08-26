import { apiRequest } from '../../lib/api-client';

export type CommunityReportStatus = 'open' | 'resolved' | 'dismissed';
export type CommunityReportReason = 'spam' | 'personal_info' | 'harassment' | 'illegal' | 'copyright' | 'other';
export type CommunityPostType = 'classTip' | 'travel';

export type AdminCommunityReport = {
  id: string;
  reason: CommunityReportReason;
  detail: string | null;
  status: CommunityReportStatus;
  resolution: 'hidden' | 'dismissed' | null;
  resolvedAt: string | null;
  createdAt: string;
  post: {
    id: string;
    type: CommunityPostType;
    title: string;
    status: 'pending_review' | 'published' | 'rejected' | 'hidden' | 'archived';
    authorLabel: string;
  };
};

export type CommunityReportFilters = {
  status: CommunityReportStatus | 'all';
  type: CommunityPostType | 'all';
  page: number;
  pageSize: number;
};

export type CommunityReportList = {
  items: AdminCommunityReport[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export function listCommunityReports(filters: CommunityReportFilters) {
  const query = new URLSearchParams({
    status: filters.status,
    type: filters.type,
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  return apiRequest<CommunityReportList>(`/admin/community-reports?${query}`);
}

export function resolveCommunityReport(reportId: string, action: 'hide' | 'dismiss') {
  return apiRequest<{ report: AdminCommunityReport }>(
    `/admin/community-reports/${encodeURIComponent(reportId)}/resolve`,
    { method: 'POST', body: JSON.stringify({ action }) },
  );
}
