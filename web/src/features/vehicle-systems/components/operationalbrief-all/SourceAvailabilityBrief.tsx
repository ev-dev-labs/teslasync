import { useTranslation } from 'react-i18next';
import type { StatPeriod } from '@/components/data-display';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { VehicleOperationalBrief } from './VehicleOperationalBrief';

interface Props {
  id: string;
  title: string;
  period: StatPeriod;
  retained: boolean;
  denominator: number;
  items: readonly { id: string; label: string; count: number; note?: string }[];
}

export function SourceAvailabilityBrief({ id, title, period, retained, denominator, items }: Props) {
  const { t } = useTranslation();
  const { fmtInt, fmtPercent } = useNumberFormatting();
  return <VehicleOperationalBrief embedded id={id} title={title} period={period} retained={retained}
    metrics={items.map(item => ({
      metricId: 'count' as const, occurrenceId: item.id, label: item.label, rawValue: item.count,
      description: t('vehicleSystems.brief.availabilityDenominator',
        'Counts are evaluated against {{count}} unique timestamp-valid rows.', { count: fmtInt(denominator) }),
      context: item.note,
      display: { formatter: (raw: number) => ({
        value: `${fmtInt(raw)} · ${denominator > 0 ? fmtPercent((raw / denominator) * 100) : '—'}`,
        unit: '',
      }) },
    }))}
  />;
}
