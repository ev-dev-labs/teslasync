import { CardGrid, useCardPlacement, type CardGridItem } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';

function PreservedPanel({ item }: { item: CardGridItem }) {
  const placement = useCardPlacement();
  if (!placement) throw new Error('Preserved panels require a CardGrid placement');
  return (
    <div
      data-preserved-panel={item.id}
      data-panel-span={placement.span}
      className={cn('min-w-0', placement.className)}
    >
      {item.content}
    </div>
  );
}

/**
 * Existing report/chart components already own their panel surface, title,
 * exports and fullscreen controls. Supply only CardGrid placement, never a
 * second LayoutCard/ChartCard surface or a replacement chart controller.
 */
export function PreservedPanelGrid({ items, label }: {
  items: readonly CardGridItem[];
  label: string;
}) {
  const safeItems = items ?? [];
  return (
    <CardGrid label={label} items={safeItems.map(item => ({
      ...item,
      content: <PreservedPanel item={item} />,
    }))} />
  );
}
