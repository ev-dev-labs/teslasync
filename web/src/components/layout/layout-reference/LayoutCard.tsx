import { useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Heading, Text } from '@/components/ui/Typography';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import { useCardPlacement } from './CardPlacementContext';
import type { CardSize } from './layoutPolicy';

export interface LayoutCardProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: CardSize;
}

export function LayoutCard({ title, description, actions, children, footer, size = 'full' }: LayoutCardProps) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const id = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  return (
    <Card
      ref={cardRef}
      padding="none"
      data-card
      data-card-size={placement?.size ?? size}
      data-card-resolved-span={placement?.span ?? 1}
      aria-labelledby={`${id}-title`}
      className={cn(
        'flex h-full min-w-0 flex-col gap-3 p-3 @container',
        placement && placement.width >= 640 && 'p-4',
        placement?.className ?? 'col-span-1',
      )}
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Heading id={`${id}-title`} level="panel" data-card-title className="break-words">{title}</Heading>
          {description && (
            <Tooltip content={description} multiline boundaryRef={cardRef}>
              <Button
                type="button"
                variant="ghost"
                aria-label={t('developerReference.layout.card.descriptionHelp', 'Read full description for {{title}}', { title })}
                className="h-auto min-h-11 w-full min-w-0 justify-start rounded-none p-0 text-start"
                onClick={event => event.currentTarget.focus()}
                onKeyDown={event => {
                  if (event.key === 'Escape') event.currentTarget.blur();
                }}
              >
                <Text as="span" variant="bodySm" data-card-desc className="min-h-11 min-w-0 flex-1 break-words line-clamp-2">
                  {description}
                </Text>
              </Button>
            </Tooltip>
          )}
        </div>
        {actions && <div className="flex min-w-0 max-w-full shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>
      <div data-card-content className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
      {footer && <div className="mt-auto min-w-0 pt-1">{footer}</div>}
    </Card>
  );
}
