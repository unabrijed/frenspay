'use client';

// F list — landing-page waitlist signups, newest first, with one-click CSV export
// (client-side Blob from the already-loaded rows — no backend CSV endpoint).
import { useCallback } from 'react';

import { api } from '@/services/api';
import { at, Btn, Denied, EmptyState, ErrorBanner, PageHead, Spinner, Table, Td, usePoll } from '@/components/ui';

export default function Waitlist() {
  const fetchList = useCallback(() => api.waitlist(), []);
  const { data, err, denied } = usePoll(fetchList, 30000);

  if (denied) return <Denied />;

  const exportCsv = () => {
    if (!data) return;
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
    const rows = [
      'email,city,created_at',
      ...data.entries.map((e) => [e.email, e.city ?? '', e.createdAt].map(esc).join(',')),
    ];
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'f-list.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex items-start justify-between">
        <PageHead title="F list" sub={data ? `${data.entries.length} signups` : undefined} />
        <Btn onClick={exportCsv} disabled={!data || data.entries.length === 0}>
          Export CSV
        </Btn>
      </div>
      <ErrorBanner msg={err} />
      {!data ? (
        <Spinner />
      ) : data.entries.length === 0 ? (
        <EmptyState text="No signups yet. The landing form posts here." />
      ) : (
        <Table head={['Email', 'City', 'Joined']}>
          {data.entries.map((e) => (
            <tr key={e.email} className="hover:bg-surface-low">
              <Td className="font-medium">{e.email}</Td>
              <Td className="text-muted">{e.city ?? '—'}</Td>
              <Td className="whitespace-nowrap text-muted">{at(e.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
