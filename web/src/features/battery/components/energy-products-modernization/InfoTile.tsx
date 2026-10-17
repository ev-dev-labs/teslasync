import type { ReactNode } from 'react';
import { Text } from '@/components/ui';

export function InfoTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <Text as="p" variant="caption" className="mb-1">{label}</Text>
      {children}
    </div>
  );
}
