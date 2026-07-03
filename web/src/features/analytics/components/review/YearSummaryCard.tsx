import { useTranslation } from 'react-i18next';
import { Car, Route, Zap, PlugZap, Leaf } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { GlassPanel, Heading, Text, Caption, HelperText } from '@/components/ui';
import { AnimatedNumber } from '@/components/data-display';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { YearReview } from '@/api/types';

interface Props {
  data: YearReview;
}

/** Screenshot-friendly recap card summarising the whole year at a glance. */
export function YearSummaryCard({ data }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const distanceUnit = unitPrefs.distance;

  const stats: { icon: LucideIcon; label: string; value: number }[] = [
    { icon: Car, label: t('yearReview.totalDrives', 'Drives'), value: data.total_drives ?? 0 },
    { icon: Route, label: distanceUnit, value: convertDistanceFromSI((data.total_distance_km ?? 0) * 1000, distanceUnit) },
    { icon: Zap, label: t('yearReview.energyKwh', 'kWh'), value: data.total_energy_kwh ?? 0 },
    { icon: PlugZap, label: t('yearReview.charges', 'Charges'), value: data.total_charge_sessions ?? 0 },
    { icon: Leaf, label: t('yearReview.co2KgSaved', 'kg CO₂ saved'), value: data.co2_offset_kg ?? 0 },
  ];

  return (
    <GlassPanel className="flex h-full flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Heading level="panel">{data.year}</Heading>
          <Caption>{t('yearReview.title', 'Year in Review')}</Caption>
        </div>
        <div className="text-end">
          <Text size="sm" weight="semibold" color="primary" className="block">{data.vehicle?.display_name ?? '—'}</Text>
          <Caption>{data.vehicle?.model ?? ''}</Caption>
        </div>
      </div>

      <ul className="space-y-2.5">
        {stats.map(({ icon: Icon, label, value }) => (
          <li key={label} className="flex items-center gap-3">
            <Icon className="h-5 w-5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            <AnimatedNumber value={value} duration={1} className="min-w-[4rem] text-lg font-bold tabular-nums text-[var(--text-primary)]" />
            <Text variant="bodySm">{label}</Text>
          </li>
        ))}
      </ul>

      {(data.gas_savings ?? 0) > 0 && (
        <div className="mt-auto border-t border-[var(--border-subtle)] pt-3">
          <Text variant="bodySm" className="text-emerald-300">
            💰 {t('yearReview.savedSummary', { amount: formatCurrency(data.gas_savings ?? 0, 0), defaultValue: 'Saved {{amount}} vs. gas' })}
          </Text>
        </div>
      )}

      <HelperText>{t('yearReview.screenshot', 'Screenshot to share your year')}</HelperText>
    </GlassPanel>
  );
}
