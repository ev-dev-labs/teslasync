import { type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';

interface OwnershipPanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  className?: string;
}

/**
 * The single section wrapper every ownership page uses. A panel is NEVER
 * hidden when its data source is empty — it renders an `EmptyState` inside the
 * same frame so the page keeps a stable shape while data loads or is absent.
 */
export function OwnershipPanel({
  title,
  description,
  actions,
  empty = false,
  emptyMessage = 'No supported data is available yet.',
  children,
  className,
}: OwnershipPanelProps) {
  return (
    <GlassPanel className={className ?? 'p-5 md:p-6'}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <PanelTitle>{title}</PanelTitle>
          {description ? (
            <Text as="p" variant="bodySm">
              {description}
            </Text>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {empty ? (
        <EmptyState /* no-action: shared wrapper reused by every ownership analysis page (charging reconciliation, warranty, tariff, etc.); each caller supplies its own `emptyMessage` describing that page's specific recovery path (or lack of one) — there is no single generic action to wire at this shared layer. */
          icon={<Info className="h-6 w-6" aria-hidden="true" />}
          message={emptyMessage}
        />
      ) : (
        children
      )}
    </GlassPanel>
  );
}
