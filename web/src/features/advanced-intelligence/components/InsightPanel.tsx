import { type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';

interface InsightPanelProps {
  title: string;
  description?: string;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  className?: string;
}

export function InsightPanel({
  title,
  description,
  empty = false,
  emptyMessage = 'No supported data is available.',
  children,
  className,
}: InsightPanelProps) {
  return (
    <GlassPanel className={className ?? 'p-5 md:p-6'}>
      <div className="mb-4 space-y-1">
        <PanelTitle>{title}</PanelTitle>
        {description ? <Text as="p" variant="bodySm">{description}</Text> : null}
      </div>
      {empty ? (
        // no-action: generic shared shell reused by many pages, each with its own empty predicate; fix belongs to the caller.
        <EmptyState icon={<Info className="h-6 w-6" aria-hidden="true" />} message={emptyMessage} />
      ) : children}
    </GlassPanel>
  );
}
