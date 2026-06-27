// metrics.ts — M6 in-memory counters exposed at GET /metrics (Prometheus text). Single-process, reset
// on restart; a real scrape target / TSDB is M7. A plain counter map is enough for one instance.
const counters: Record<string, number> = Object.create(null);

export const metrics = {
  inc(name: string, by = 1): void {
    counters[name] = (counters[name] ?? 0) + by;
  },
  get(name: string): number {
    return counters[name] ?? 0;
  },
  snapshot(): Record<string, number> {
    return { ...counters };
  },
  /** Prometheus text exposition (one `pay_<name> <value>` line per counter). */
  prometheus(): string {
    const lines = Object.entries(counters).map(([k, v]) => `pay_${k} ${v}`);
    return lines.join('\n') + (lines.length ? '\n' : '');
  },
};
