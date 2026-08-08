import { BookOpenCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { TrueCostSectionProps } from './types';

export function TrueCostMethodology({
  analysis,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const limits = [
    t('tco.methodology.costedOnly', 'Charging totals include only sessions whose recorded cost is greater than zero; excluded free or missing-cost sessions cannot be counted from this response.'),
    t('tco.methodology.scopeMismatch', 'Charging spend and energy use a different filter and temporal scope from positive-drive distance and dates.'),
    t('tco.methodology.lifetimeGas', 'The lifetime gasoline equivalent is distance-derived from positive-drive kilometres, configured price per unit, and comparison MPG.'),
    t('tco.methodology.monthlyGas', 'Only monthly gasoline equivalents are energy-derived, using lifetime km/kWh or the endpoint 5 km/kWh fallback.'),
    t('tco.methodology.calendar', 'Monthly labels use backend/database calendar semantics; no vehicle-local or UTC timezone is exposed.'),
    t('tco.methodology.maintenance', 'Maintenance is a flat $50-per-modeled-month heuristic, not measured service spend.'),
    t('tco.methodology.scenarios', 'Break-even and sensitivity outputs are algebraic what-if scenarios, not forecasts or recommendations.'),
    t('tco.methodology.negative', 'Negative deltas are valid modeled losses and are never relabeled as savings.'),
  ];

  return (
    <section
      data-testid="tco-methodology"
      aria-label={t('tco.methodology.aria', 'True Cost methodology and limitations')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.methodology.title', 'Methodology and limitations')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('tco.methodology.subtitle', 'Deterministic interpretation of the canonical operating-cost envelope with runtime validation and no imputed UI rows.')}
        </Text>
        <ol className="grid gap-2 md:grid-cols-2">
          {limits.map((limit, index) => (
            <li
              key={limit}
              className="flex gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
            >
              <Text variant="label" mono>
                {t('tco.methodology.item', '{{number}}.', { number: index + 1 })}
              </Text>
              <Text variant="bodySm">{limit}</Text>
            </li>
          ))}
        </ol>
        {analysis.monthlyAccounting.arrayAvailability === 'invalid' && (
          <Text as="p" variant="error" className="mt-3">
            {t('tco.methodology.invalidMonthly', 'The monthly_breakdown field is malformed; no monthly rows were fabricated.')}
          </Text>
        )}
      </GlassPanel>
    </section>
  );
}
