import type { ReactNode } from 'react';
import { Text } from '@/components/ui/Typography';
import { cn } from '@/lib/cn';

export interface ChartSummaryItem {
  id: string;
  /** Self-explanatory label, e.g. "Elevation gain" — never a bare "Gain". */
  label: string;
  /** Pre-formatted value, exactly as the caller computed it. */
  value: ReactNode;
  /** Unit shown with the label, e.g. "Max power (kW)", so it reads even when the value is missing. */
  unit?: string;
}

export interface ChartSummaryProps {
  /** Accessible name for the key-value list. */
  label: string;
  items?: readonly ChartSummaryItem[];
  /** Method or scope note that belongs to these values. */
  caption?: ReactNode;
  /** Richer summaries (e.g. a per-signal table) rendered after the items. */
  children?: ReactNode;
}

// Equal columns per row: up to four values share one row; five or six split
// into rows of three so no row ends with a lone orphan.
const columnClass: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

/**
 * Compact summary row rendered inside a chart card, between its title and
 * the chart (`<ChartCard summary={…}>`). Presentation only: values arrive
 * formatted, so moving a summary into its card never changes a number.
 */
export function ChartSummary({ label, items = [], caption, children }: ChartSummaryProps) {
  const columns = items.length <= 4 ? Math.max(items.length, 1) : 3;
  return (
    <div data-chart-summary className="min-w-0 space-y-2">
      {items.length > 0 && (
        <dl
          role="group"
          aria-label={label}
          className={cn('grid grid-cols-2 gap-x-4 gap-y-2', columnClass[columns])}
        >
          {items.map(item => (
            <div key={item.id} className="min-w-0" data-chart-summary-item={item.id}>
              <Text as="dt" variant="caption" className="break-words">
                {item.unit ? `${item.label} (${item.unit})` : item.label}
              </Text>
              <Text as="dd" variant="bodySm" weight="medium" className="tabular-nums">{item.value}</Text>
            </div>
          ))}
        </dl>
      )}
      {children}
      {caption && <Text as="p" variant="caption">{caption}</Text>}
    </div>
  );
}
