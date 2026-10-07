import type { ReactNode } from 'react';

export function ApiLogsRuntimeList({ label, children }: { label: string; children: ReactNode }) {
  return (
    // A read-only scroll region needs keyboard focus without pretending the evidence is an interactive listbox.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div role="region" aria-label={label} tabIndex={0} className="max-h-64 overflow-y-auto overscroll-contain rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
      <ul aria-label={label} className="space-y-3">{children}</ul>
    </div>
  );
}
