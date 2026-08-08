import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

export function TrueCostTemporalCoverage({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const monthly = analysis.eligibleMonthly;
  const firstMonth = monthly[0]?.month ?? null;
  const lastMonth = monthly[monthly.length - 1]?.month ?? null;
  const span = analysis.driveSpan;
  const rows = [
    {
      label: t('tco.coverage.firstDrive', 'First positive-distance drive'),
      value: span.firstDate ?? '—',
    },
    {
      label: t('tco.coverage.lastDrive', 'Last positive-distance drive'),
      value: span.lastDate ?? '—',
    },
    {
      label: t('tco.coverage.driveSpan', 'Observed drive span'),
      value: span.spanDays != null
        ? t('tco.coverage.days', '{{value}} days', {
          value: display.formatNumber(span.spanDays, 1),
        })
        : '—',
    },
    {
      label: t('tco.coverage.modeledMonths', 'Modeled span months'),
      value: span.available
        ? display.formatNumber(analysis.metrics.monthsOfDriveSpan.value, 1)
        : '—',
    },
    {
      label: t('tco.coverage.monthlyRange', 'Returned costed-month range'),
      value: firstMonth && lastMonth
        ? t('tco.coverage.rangeValue', '{{first}} through {{last}}', {
          first: display.formatMonth(firstMonth),
          last: display.formatMonth(lastMonth),
        })
        : '—',
    },
    {
      label: t('tco.coverage.gaps', 'Missing monthly rows inside range'),
      value: analysis.gapCount != null
        ? display.formatNumber(analysis.gapCount, 0)
        : '—',
    },
  ];

  return (
    <section
      data-testid="tco-temporal-coverage"
      aria-label={t('tco.coverage.aria', 'Temporal coverage and monthly gap evidence')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.coverage.title', 'Temporal, coverage, and gap evidence')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('tco.coverage.subtitle', 'Calendar labels follow backend/database semantics because the endpoint exposes no timezone. A gap means no positive-cost row was returned, not no charging.')}
        </Text>
        <TrueCostSectionBody state={state}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {rows.map((row) => (
              <div
                key={row.label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <Text as="p" variant="metricLabel">{row.label}</Text>
                <Text as="p" variant="bodySm" mono className="mt-1">{row.value}</Text>
              </div>
            ))}
          </div>
        </TrueCostSectionBody>
      </GlassPanel>
    </section>
  );
}
