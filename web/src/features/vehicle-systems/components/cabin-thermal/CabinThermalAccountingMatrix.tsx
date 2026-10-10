import { useTranslation } from 'react-i18next';

import { LayoutCard, Grid } from '@/components/layout';
import {
  Badge,
  MetricLabel,
  Text,
} from '@/components/ui';

import {
  CABIN_ROW_EXCLUSION_REASONS,
  type CabinThermalSummary,
} from '../../lib/cabinThermal';
import { cabinRowExclusionLabel } from './labels';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';

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
  const { fmtInt } = useNumberFormatting();
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
      <LayoutCard title={t('cabinThermal.accounting.title', 'Data and accounting matrix')}>
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
          <VehicleOperationalBrief embedded id="cabin-thermal-exclusions-summary"
            title={t('cabinThermal.accounting.exclusions', 'Mutually exclusive raw-row exclusions')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('cabinThermal.accounting.subtitle', 'Exact identities prevent returned rows, normalized samples, candidates, and accepted fits from being conflated.') }}
            metrics={[
              ...CABIN_ROW_EXCLUSION_REASONS.map(reason => ({
                metricId: 'count' as const, occurrenceId: reason,
                label: cabinRowExclusionLabel(t, reason), rawValue: summary.rowExclusions[reason],
                display: { formatter: (raw: number) => ({ value: fmtInt(raw), unit: '' }) },
              })),
              { metricId: 'count', occurrenceId: 'hvac-on', label: t('cabinThermal.accounting.hvacOn', 'Normalized HVAC-on rows'), rawValue: accounting.hvacOnRows, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
              { metricId: 'count', occurrenceId: 'hvac-unknown', label: t('cabinThermal.accounting.hvacUnknown', 'Normalized HVAC-unknown rows'), rawValue: accounting.hvacUnknownRows, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
            ]}
          />
        </CabinThermalSectionBody>
      </LayoutCard>
    </section>
  );
}
