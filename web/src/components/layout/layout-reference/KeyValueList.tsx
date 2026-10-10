import { Text } from '@/components/ui/Typography';
import { Tooltip } from '@/components/ui/Tooltip';

export interface KeyValueItem {
  id: string;
  label: string;
  value: string | null;
  missingReason?: string;
}

/** Diagnostic text facts only. Numeric summaries belong to the stats owner's
 * StatStrip/StatGroup; this adapter is not a stat formatter or substitute. */
export function KeyValueList({ items }: { items: readonly KeyValueItem[] }) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-4 @[640px]:grid-cols-2">
      {(items ?? []).map(item => (
        <div key={item.id} className="flex min-w-0 flex-wrap justify-between gap-2 border-b border-[var(--border-subtle)] py-3">
          <Text as="dt" variant="bodySm" className="min-w-0 max-w-full break-words">{item.label}</Text>
          <dd className="min-w-0 max-w-full break-words text-end">
            {item.value == null && item.missingReason ? (
              <Tooltip content={item.missingReason} multiline>
                <Text variant="bodySm" tabIndex={0} className="inline-flex min-h-11 items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
                  {'—'}
                </Text>
              </Tooltip>
            ) : <Text variant="bodySm">{item.value ?? '—'}</Text>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
