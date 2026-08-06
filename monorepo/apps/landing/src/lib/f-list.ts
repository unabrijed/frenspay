export function focusFList(): void {
  const anchor = document.getElementById('f-list');
  const field = document.getElementById('f-list-email');
  const status = document.getElementById('f-list-status');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  anchor?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  const focusTarget = field ?? status;
  if (!focusTarget) return;

  window.setTimeout(
    () => focusTarget.focus({ preventScroll: true }),
    reduced ? 0 : 520,
  );
}
