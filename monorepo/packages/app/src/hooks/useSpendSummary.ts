import { useEffect, useState } from 'react';
import { expensesApi } from '../services/api';
import { usePayStore } from '../store';

export function useSpendSummary(filter: 'All' | 'Personal' | 'Trips') {
  const transactions = usePayStore((s) => s.transactions),
    requests = usePayStore((s) => s.requests),
    loaded = usePayStore((s) => s.firstLoadDone);
  const [result, setResult] = useState<{ filter: string; spentUsd: string; yourShareUsd: string } | null>(null);
  const [error, setError] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void expensesApi
      .summary(filter === 'All' ? 'all' : filter === 'Trips' ? 'trips' : 'personal')
      .then((data) => {
        if (alive) {
          setResult({ ...data, filter });
          setError(false);
        }
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [filter, loaded, transactions, requests, revision]);
  return { summary: result?.filter === filter ? result : null, error, retry: () => setRevision((n) => n + 1) };
}
