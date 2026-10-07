import type { ReactNode } from 'react';
import { Text } from '@/components/ui';

/** Context is kept beside the animated lifetime headline, not a new aggregate. */
export function HeroChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text-secondary)]">
      {icon}
      <Text as="span" size="xs" color="secondary">{children}</Text>
    </span>
  );
}
