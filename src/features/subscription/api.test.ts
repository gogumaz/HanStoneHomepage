import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAdminPaymentReconciliationQuery,
  downloadAdminPaymentReconciliationCsv,
  listAdminPaymentReconciliation,
} from './api';

describe('payment reconciliation API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serializes period, status, search, and pagination filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { items: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const query = buildAdminPaymentReconciliationQuery({
      from: '2026-08-01',
      to: '2026-08-23',
      status: 'paid',
      reconciliation: 'attention',
      search: ' 결제 학생 ',
      page: 3,
      pageSize: 50,
    });
    expect(query).toBe('?from=2026-08-01&to=2026-08-23&status=paid&reconciliation=attention&search=%EA%B2%B0%EC%A0%9C+%ED%95%99%EC%83%9D&page=3&pageSize=50');

    await listAdminPaymentReconciliation({ status: 'paid', page: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/payments/reconciliation?status=paid&page=2',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('downloads the CSV with the server-provided filename and without page parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('\uFEFF"주문번호"\r\n"order-1"\r\n', {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="payment-reconciliation-2026-08-23.csv"',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadAdminPaymentReconciliationCsv({
      from: '2026-08-01',
      to: '2026-08-23',
      page: 4,
      pageSize: 50,
    });

    expect(result.filename).toBe('payment-reconciliation-2026-08-23.csv');
    expect(result.blob.type).toContain('text/csv');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/payments/reconciliation.csv?from=2026-08-01&to=2026-08-23',
      { credentials: 'include' },
    );
  });
});
