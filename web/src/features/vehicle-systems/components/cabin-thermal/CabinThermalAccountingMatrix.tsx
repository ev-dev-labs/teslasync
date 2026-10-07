import { Binary } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import {
  CABIN_ROW_EXCLUSION_REASONS,
  type CabinThermalSummary,
} from '../../lib/cabinThermal';
import { cabinRowExclusionLabel } from './labels';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalAccountingMatrixProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
}

function IdentityCard({
  label,
  equation,
  balanced,
}: {
  label: string;
  equation: string;
  balanced: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <MetricLabel>{label}</MetricLabel>
        <Badge variant={balanced ? 'success' : 'danger'}>
          {balanced
            ? t('cabinThermal.accounting.balanced', 'Balances')
            : t('cabinThermal.accounting.mismatch', 'Mismatch')}
        </Badge>
      </div>
      <Text
        as="div"
        size="base"
        weight="semibold"
        color="primary"
        className="mt-2"
      >
        {equation}
      </Text>
    </div>
  );
}

export function CabinThermalAccountingMatrix({
  summary,
  state,
}: CabinThermalAccountingMatrixProps) {
  const { t } = useTranslation();
  const accounting = summary.accounting;
  const rejectionSum = summary.rejectionReasonCounts.reduce(
    (sum, reason) => sum + reason.count,
    0,
  );
  const rowsBalance =
    accounting.returnedRows
    === accounting.normalizedRows + accounting.excludedRows;
  const candidatesBalance =
    accounting.candidateWindows
    === accounting.acceptedFits + accounting.rejectedCandidates;
  const reasonsBalance = rejectionSum === accounting.rejectedCandidates;

  return (
    <section data-testid="cabin-thermal-accounting">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Binary className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.accounting.title', 'Data and accounting matrix')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cabinThermal.accounting.subtitle',
            'Exact identities prevent returned rows, normalized samples, candidates, and accepted fits from being conflated.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 1, xl: 3 }} gap={3}>
            <IdentityCard
              label={t('cabinThermal.accounting.rowIdentity', 'Raw-row identity')}
              equation={t('cabinThermal.accounting.rowEquation', '{{returned}} = {{normalized}} + {{excluded}}', {
                returned: fmtInt(accounting.returnedRows),
                normalized: fmtInt(accounting.normalizedRows),
                excluded: fmtInt(accounting.excludedRows),
              })}
              balanced={rowsBalance}
            />
            <IdentityCard
              label={t('cabinThermal.accounting.windowIdentity', 'Candidate identity')}
              equation={t('cabinThermal.accounting.windowEquation', '{{candidates}} = {{accepted}} + {{rejected}}', {
                candidates: fmtInt(accounting.candidateWindows),
                accepted: fmtInt(accounting.acceptedFits),
                rejected: fmtInt(accounting.rejectedCandidates),
              })}
              balanced={candidatesBalance}
            />
            <IdentityCard
              label={t('cabinThermal.accounting.reasonIdentity', 'Rejection-reason identity')}
              equation={t('cabinThermal.accounting.reasonEquation', '{{reasons}} = {{rejected}} rejected', {
                reasons: fmtInt(rejectionSum),
                rejected: fmtInt(accounting.rejectedCandidates),
              })}
              balanced={reasonsBalance}
            />
          </Grid>
          <Text as="h4" variant="label" className="mb-3 mt-5">
            {t('cabinThermal.accounting.exclusions', 'Mutually exclusive raw-row exclusions')}
          </Text>
          <Grid cols={{ default: 2, md: 3, xl: 4 }} gap={3}>
            {CABIN_ROW_EXCLUSION_REASONS.map((reason) => (
              <div key={reason} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <MetricLabel>{cabinRowExclusionLabel(t, reason)}</MetricLabel>
                <MetricValue className="mt-1">{fmtInt(summary.rowExclusions[reason])}</MetricValue>
              </div>
            ))}
            <div className="rounded-lg border border-[var(--border-subtle)] p-3">
              <MetricLabel>{t('cabinThermal.accounting.hvacOn', 'Normalized HVAC-on rows')}</MetricLabel>
              <MetricValue className="mt-1">{fmtInt(accounting.hvacOnRows)}</MetricValue>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] p-3">
              <MetricLabel>{t('cabinThermal.accounting.hvacUnknown', 'Normalized HVAC-unknown rows')}</MetricLabel>
              <MetricValue className="mt-1">{fmtInt(accounting.hvacUnknownRows)}</MetricValue>
            </div>
          </Grid>
        </CabinThermalSectionBody>
      </GlassPanel>
    </section>
  );
}
