import type { ReactNode } from 'react';
import { Text } from '@/components/ui';

export function InfoTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-app-part="card" data-app-card-kind="record" data-surface-variant="standalone"
      className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <Text data-app-part="record-header record-title" as="p" variant="caption" className="mb-1">{label}</Text>
      <div data-app-part="record-body">{children}</div>
    </div>
  );
}
