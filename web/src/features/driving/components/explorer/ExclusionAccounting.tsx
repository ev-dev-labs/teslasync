import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';
import { KVList } from '@/components/data-display';

import type { ExplorerExclusions } from '../../lib/explorer';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ExclusionAccountingProps {
  exclusions: ExplorerExclusions;
}

export function ExclusionAccounting({
  exclusions,
}: ExclusionAccountingProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const rows = [
    {
      label: t(
        'explorer.coverage.missingTimestamp',
        'Missing timestamp',
      ),
      value: exclusions.missingTimestamp,
    },
    {
      label: t(
        'explorer.coverage.invalidTimestamp',
        'Invalid timestamp',
      ),
      value: exclusions.invalidTimestamp,
    },
    {
      label: t(
        'explorer.coverage.missingCoordinates',
        'Missing end coordinates',
      ),
      value: exclusions.missingCoordinates,
    },
    {
      label: t(
        'explorer.coverage.invalidCoordinates',
        'Non-finite end coordinates',
      ),
      value: exclusions.invalidCoordinates,
    },
    {
      label: t(
        'explorer.coverage.outOfRangeCoordinates',
        'Out-of-range end coordinates',
      ),
      value: exclusions.outOfRangeCoordinates,
    },
  ];

  return (
    <div data-app-part="card" data-surface-variant="standalone" className="rounded-xl border border-[var(--border-subtle)] p-4">
      <Text as="p" variant="label" className="mb-3">
        {t(
          'explorer.coverage.exclusions',
          'Exclusive exclusion accounting',
        )}
      </Text>
      <KVList wrap items={rows.map((row) => ({
        label: row.label,
        value: <Text as="span" variant="bodySm" mono>{fmtInt(row.value)}</Text>,
      }))} />
    </div>
  );
}
