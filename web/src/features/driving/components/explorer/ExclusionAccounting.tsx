import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';

import type { ExplorerExclusions } from '../../lib/explorer';

interface ExclusionAccountingProps {
  exclusions: ExplorerExclusions;
}

export function ExclusionAccounting({
  exclusions,
}: ExclusionAccountingProps) {
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
    <div className="rounded-xl border border-[var(--border-subtle)] p-4">
      <Text as="p" variant="label" className="mb-3">
        {t(
          'explorer.coverage.exclusions',
          'Exclusive exclusion accounting',
        )}
      </Text>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-center justify-between gap-3"
          >
            <Text as="span" variant="bodySm">{row.label}</Text>
            <Text as="span" variant="bodySm" mono>{fmtInt(row.value)}</Text>
          </li>
        ))}
      </ul>
    </div>
  );
}
