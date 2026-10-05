import { Children, type ReactElement, type ReactNode } from 'react';
import { CardGrid, useCardPlacement, type CardGridItem } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { cn } from '@/lib/cn';

interface ClimateRenderGroupProps {
  id: string;
  size?: CardGridItem['size'];
  delay?: number;
  label?: string;
  children: ReactNode;
}

/** Placement is consumed below CardGrid's provider, never in the page. */
export function ClimateRenderGroup({
  id, delay = 0, label, children,
}: ClimateRenderGroupProps) {
  const placement = useCardPlacement();
  return (
    <FadeIn delay={delay} className={cn('min-w-0', placement?.className)}>
      <div data-climate-group={id} data-climate-span={placement?.span}
        role={label ? 'group' : undefined}
        aria-label={label} className="@container h-full min-w-0 [&>div]:h-full">
        {children}
      </div>
    </FadeIn>
  );
}

/** One measurement boundary and one source-order packer for the entire page. */
export function ClimateRenderGrid({
  label, children,
}: {
  label: string;
  children: ReactElement<ClimateRenderGroupProps>[];
}) {
  const groups = Children.toArray(children) as ReactElement<ClimateRenderGroupProps>[];
  const items: CardGridItem[] = groups.map(group => ({
    id: group.props.id,
    size: group.props.size ?? 'full',
    content: group,
  }));
  return <CardGrid label={label} items={items} />;
}
