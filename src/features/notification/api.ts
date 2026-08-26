import { apiRequest } from '../../lib/api-client';
export type UserNotification = { id: string; kind: 'inquiry_answered'; resourceType: string; resourceId: string; resourceVersion: number; title: string; message: string; readAt: string | null; createdAt: string };
export type NotificationList = { items: UserNotification[]; unreadCount: number; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
export const listNotifications = (page = 1) => apiRequest<NotificationList>(`/me/notifications?page=${page}&pageSize=20`);
export const markNotificationRead = (id: string) => apiRequest<{ notification: UserNotification }>(`/me/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
export const markAllNotificationsRead = () => apiRequest<{ updated: number; readAt: string }>('/me/notifications/read-all', { method: 'PATCH' });
