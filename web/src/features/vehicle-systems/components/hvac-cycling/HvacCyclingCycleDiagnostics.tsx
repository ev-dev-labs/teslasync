import { RotateCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import { AlertBanner } from '@/components/feedback';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';

interface HvacCyclingCycleDiagnosticsProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">{value}</Text>
    </div>
  );
}

export function HvacCyclingCycleDiagnostics({
  summary,
  state,
}: HvacCyclingCycleDiagnosticsProps) {
  const { t } = useTranslation();
  const censoredActive =
    summary.activeRunCount - summary.completeOnRunCount;
  const nonShortComplete =
    summary.completeOnRunCount - summary.shortCompleteOnRunCount;

  return (
    <section data-testid="hvac-cycling-cycle-diagnostics">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <RotateCw className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.cycles.title', 'Complete-cycle and short-cycle diagnostics')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.cycles.subtitle',
            'A short-cycle classification requires an active run bounded by observed off-to-on and on-to-off transitions.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, md: 3 }} gap={3}>
            <Diagnostic
              label={t('hvacCycling.cycles.activeFragments', 'Active run fragments')}
              value={fmtInt(summary.activeRunCount)}
            />
            <Diagnostic
              label={t('hvacCycling.cycles.complete', 'Qualified complete active runs')}
              value={fmtInt(summary.completeOnRunCount)}
            />
            <Diagnostic
              label={t('hvacCycling.cycles.censored', 'Boundary-censored active runs')}
              value={fmtInt(censoredActive)}
            />
            <Diagnostic
              label={t('hvacCycling.cycles.short', 'Qualified short runs')}
              value={fmtInt(summary.shortCompleteOnRunCount)}
            />
            <Diagnostic
              label={t('hvacCycling.cycles.notShort', 'Qualified non-short runs')}
              value={fmtInt(nonShortComplete)}
            />
            <Diagnostic
              label={t('hvacCycling.cycles.rate', 'Short-cycle rate')}
              value={summary.qualifiedShortCycleRate != null
                ? fmtPercent(summary.qualifiedShortCycleRate * 100, 1)
                : '—'}
            />
          </Grid>
          {summary.activeRunCount > 0 && summary.completeOnRunCount === 0 ? (
            <AlertBanner
              className="mt-3"
              variant="warning"
              icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
            >
              <Text as="p" variant="caption">
                {t(
                  'hvacCycling.cycles.withheld',
                  'The denominator is zero: every active fragment is left-censored, right-censored, or both. No short-cycle rate is published.',
                )}
              </Text>
            </AlertBanner>
          ) : (
            <Text as="p" variant="caption" className="mt-3">
              {t(
                'hvacCycling.cycles.denominator',
                '{{short}} short ÷ {{complete}} complete active runs; {{starts}} observed active starts are reported separately.',
                {
                  short: fmtInt(summary.shortCompleteOnRunCount),
                  complete: fmtInt(summary.completeOnRunCount),
                  starts: fmtInt(summary.observedOnStarts),
                },
              )}
            </Text>
          )}
        </HvacCyclingSectionBody>
      </GlassPanel>
    </section>
  );
}
