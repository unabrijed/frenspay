import s from './loading-status.module.css';

export function LoadingStatus({ label = 'Loading…' }: { label?: string }) {
  return <div className={s.status} role="status" aria-live="polite">
    <span className={s.spinner} aria-hidden="true" /><span>{label}</span>
  </div>;
}
