import { useId, useRef, useState, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { cn } from '@/lib/cn';
import { useCardPlacement } from './CardPlacementContext';
import type { CardSize } from './layoutPolicy';
import { CardDescription } from './CardDescription';
import { CardHeaderContext } from './CardHeaderContext';

export interface LayoutCardProps {
  title: string;
  icon?: ReactNode;
  description?: string;
  actions?: ReactNode;
  summary?: ReactNode;
  /** Override the host header when a child owns its title and controls. */
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: CardSize;
}

export function LayoutCard({ title, icon, description, actions, summary, header, children, footer, size = 'full' }: LayoutCardProps) {
  const placement = useCardPlacement();
  const id = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [headerActions, setHeaderActions] = useState<HTMLDivElement | null>(null);
  const [summaryTarget, setSummaryTarget] = useState<HTMLDivElement | null>(null);
  return (
    <Card
      layout
      ref={cardRef}
      padding="none"
      data-card
      data-card-header-owner={header === undefined ? 'host' : 'content'}
      data-card-size={placement?.size ?? size}
      data-card-resolved-span={placement?.span ?? 1}
      aria-labelledby={header === undefined ? `${id}-title` : undefined}
      aria-label={header === undefined ? undefined : title}
      className={cn(
        'flex h-full min-w-0 flex-col gap-3 p-3 @container',
        placement && placement.width >= 640 && 'p-4',
        placement?.className ?? 'col-span-1',
      )}
    >
      {header === undefined ? <header data-card-header data-card-slot="header" className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        {/* flex-1 (basis 0) would absorb all shrinkage and defeat the wrap,
            crushing the title when the actions row is wide. Floor the title
            so it wraps to its own line instead of collapsing. */}
        <div className="min-w-[min(100%,12rem)] flex-1 space-y-1">
          <Heading id={`${id}-title`} level="panel" data-card-title className={cn('break-words', icon && 'flex items-center gap-2')}>
            {icon ? <><span className="shrink-0">{icon}</span><span className="min-w-0 break-words">{title}</span></> : title}
          </Heading>
          {description && <CardDescription title={title} description={description} boundaryRef={cardRef} />}
        </div>
        <div ref={setHeaderActions} data-card-actions className="ms-auto flex min-w-0 max-w-full shrink-0 flex-wrap justify-end gap-2">{actions}</div>
      </header> : header}
      {header === undefined && <div ref={setSummaryTarget} data-card-slot="summary" className="card-layout-summary">{summary}</div>}
      <CardHeaderContext.Provider value={header === undefined ? { target: headerActions, summaryTarget, title } : null}>
        <CardContent data-card-content layoutSlot={header === undefined ? 'body' : 'delegate'}>{children}</CardContent>
      </CardHeaderContext.Provider>
      {footer && <div data-card-footer data-card-slot="footer" className="mt-auto min-w-0 pt-1">{footer}</div>}
    </Card>
  );
}
