import { useState, type MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCurrentUser } from '../auth/api';
import { listNotifications, markAllNotificationsRead, markNotificationRead, type UserNotification } from './api';

const date = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function NotificationsPage() {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState('');
  const me = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false });
  const list = useQuery({ queryKey: ['notifications', page], queryFn: () => listNotifications(page), enabled: Boolean(me.data), retry: false });
  const refresh = () => client.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh });
  const openInquiry = async (event: MouseEvent<HTMLAnchorElement>, item: UserNotification) => {
    event.preventDefault();
    if (read.isPending) return;
    setActionError('');
    try {
      if (!item.readAt) await read.mutateAsync(item.id);
      window.location.assign(`/board.html?type=inquiry&id=${encodeURIComponent(item.resourceId)}`);
    } catch {
      setActionError('알림을 읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };
  return <main className="catalog-page notifications-page">
    <header className="catalog-header"><Link className="back-link" to="/">← 개발 현황으로</Link><p className="react-stack-eyebrow">MY NOTIFICATIONS</p><h1>알림함</h1><p>문의 답변과 서비스 안내를 계정별로 확인합니다.</p></header>
    {!me.isLoading && !me.data ? <section className="subscription-callout"><h2>로그인이 필요합니다.</h2><Link to="/account">로그인하기</Link></section> : null}
    {me.data ? <>
      <div className="notification-toolbar"><strong>읽지 않은 알림 {list.data?.unreadCount ?? 0}개</strong><button type="button" disabled={!list.data?.unreadCount || readAll.isPending} onClick={() => readAll.mutate()}>모두 읽음</button></div>
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
      {list.isLoading ? <p role="status">알림을 불러오고 있습니다.</p> : null}
      {list.data?.items.length === 0 ? <p className="notification-empty">새로운 알림이 없습니다.</p> : null}
      <ul className="notification-list">{list.data?.items.map((item) => <li key={item.id} data-read={Boolean(item.readAt)}>
        <div><span>{item.readAt ? '읽음' : '새 알림'}</span><time>{date(item.createdAt)}</time></div><h2>{item.title}</h2><p>{item.message}</p>
        <div className="notification-actions">{!item.readAt ? <button type="button" disabled={read.isPending} onClick={() => read.mutate(item.id)}>읽음 처리</button> : null}{item.kind === 'inquiry_answered' ? <a href={`/board.html?type=inquiry&id=${encodeURIComponent(item.resourceId)}`} onClick={(event) => void openInquiry(event, item)}>문의 답변 열기</a> : null}</div>
      </li>)}</ul>
      {list.data && list.data.pagination.totalPages > 1 ? <nav className="consultation-pagination" aria-label="알림 페이지"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button><span>{page} / {list.data.pagination.totalPages}</span><button disabled={page >= list.data.pagination.totalPages} onClick={() => setPage(page + 1)}>다음</button></nav> : null}
    </> : null}
  </main>;
}
