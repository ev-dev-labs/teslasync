import { useMemo } from 'react';
import { Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  DataTable,
  Text,
  type Column,
} from '@/components/ui';
import { LayoutCard } from '@/components/layout';

import type { BatteryPassportAnalysis } from '../../lib/batteryPassportAnalysis';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';

interface BatteryPassportProvenanceMatrixProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
}

interface ProvenanceRow {
  field: string;
  value: string;
  source: string;
  binding: 'value' | 'utc_day' | 'not_bound';
}

export function BatteryPassportProvenanceMatrix({
  analysis,
  state,
}: BatteryPassportProvenanceMatrixProps) {
  const { fmtInt, fmtScientificNumber, fmtNumber, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDayKey } = useDateFormat();
  const passport = state.passport;
  const facts = analysis.hashFacts;
  const thermal = analysis.thermal.sumPct;
  const trendCount = Array.isArray(passport?.degradation_trend)
    ? passport.degradation_trend.length
    : 0;
  const recommendationCount = Array.isArray(passport?.recommendations)
    ? passport.recommendations.length
    : 0;
  const bindingLabels = useMemo(() => ({
    utc_day: t('batteryPassport.provenance.utcDay', 'Yes, canonical day'),
    value: t('batteryPassport.provenance.yes', 'Yes'),
    not_bound: t('batteryPassport.provenance.no', 'No'),
  }), [t]);
  const rows = useMemo<ProvenanceRow[]>(
    () => [
      {
        field: t(
          'batteryPassport.provenance.vehicleId',
          'vehicle_id',
        ),
        value: facts.vehicleId != null
          ? fmtInt(facts.vehicleId)
          : '—',
        source: t(
          'batteryPassport.provenance.vehicleIdSource',
          'Vehicle identifier; exact integer is in the v1 canonical string.',
        ),
        binding: 'value',
      },
      {
        field: t(
          'batteryPassport.provenance.firstObserved',
          'first_observed_at day',
        ),
        value: facts.firstObservedDay === '0001-01-01'
          ? facts.firstObservedDay
          : formatDayKey(facts.firstObservedDay),
        source: t(
          'batteryPassport.provenance.firstObservedSource',
          'Canonical earliest charging or drive day; absence canonicalizes to 0001-01-01.',
        ),
        binding: 'utc_day',
      },
      {
        field: t('batteryPassport.provenance.soh', 'soh_pct'),
        value: facts.sohPct != null
          ? fmtScientificNumber(facts.sohPct, 4)
          : '—',
        source: t(
          'batteryPassport.provenance.sohSource',
          'Certificate-reported SoH numeric value.',
        ),
        binding: 'value',
      },
      {
        field: t(
          'batteryPassport.provenance.capacity',
          'capacity_kwh',
        ),
        value: facts.capacityKwh != null
          ? fmtScientificNumber(facts.capacityKwh, 4)
          : '—',
        source: t(
          'batteryPassport.provenance.capacitySource',
          'Reported kWh certificate field.',
        ),
        binding: 'value',
      },
      {
        field: t(
          'batteryPassport.provenance.efc',
          'equivalent_full_cycles',
        ),
        value: facts.equivalentFullCycles != null
          ? fmtScientificNumber(facts.equivalentFullCycles, 4)
          : '—',
        source: t(
          'batteryPassport.provenance.efcSource',
          'Server-derived charged-energy throughput proxy.',
        ),
        binding: 'value',
      },
      {
        field: t(
          'batteryPassport.provenance.fastRatio',
          'fast_charge_ratio',
        ),
        value: facts.fastChargeRatio != null
          ? fmtScientificNumber(facts.fastChargeRatio, 4)
          : '—',
        source: t(
          'batteryPassport.provenance.fastRatioSource',
          'Fast-charge session share as a fraction.',
        ),
        binding: 'value',
      },
      {
        field: t(
          'batteryPassport.provenance.issued',
          'issued_at day',
        ),
        value: formatDayKey(facts.issuedAtDay),
        source: t(
          'batteryPassport.provenance.issuedSource',
          'Canonical certificate issue day, not the full issue instant.',
        ),
        binding: 'utc_day',
      },
      {
        field: t(
          'batteryPassport.provenance.vin',
          'vin_masked',
        ),
        value: passport?.vin_masked || '—',
        source: t(
          'batteryPassport.provenance.vinSource',
          'Masked identity display field.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.provenance.originalCapacity',
          'original_capacity_kwh',
        ),
        value: analysis.metrics.originalCapacityKwh != null
          ? fmtNumber(analysis.metrics.originalCapacityKwh)
          : '—',
        source: t(
          'batteryPassport.provenance.originalCapacitySource',
          'Server-selected nameplate reference.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.provenance.avgLimit',
          'avg_charge_limit_pct',
        ),
        value: analysis.metrics.avgChargeLimitPct != null
          ? fmtPercent(analysis.metrics.avgChargeLimitPct)
          : '—',
        source: t(
          'batteryPassport.provenance.avgLimitSource',
          'Average available charge-end SoC.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.provenance.thermal',
          'thermal_exposure',
        ),
        value: thermal != null ? fmtPercent(thermal) : '—',
        source: t(
          'batteryPassport.provenance.thermalSource',
          'Three ambient-temperature drive shares; value shown is their exact sum.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.provenance.grade',
          'health_grade',
        ),
        value: analysis.metrics.reportedGrade ?? '—',
        source: t(
          'batteryPassport.provenance.gradeSource',
          'Certificate-reported server scoring output.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.provenance.trend',
          'degradation_trend',
        ),
        value: t(
          'batteryPassport.provenance.pointCount',
          '{{count}} returned points',
          { count: trendCount },
        ),
        source: t(
          'batteryPassport.provenance.trendSource',
          'Returned daily SoH estimates in the fixed certificate calendar.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.provenance.recommendations',
          'recommendations',
        ),
        value: t(
          'batteryPassport.provenance.outputCount',
          '{{count}} server outputs',
          { count: recommendationCount },
        ),
        source: t(
          'batteryPassport.provenance.recommendationsSource',
          'Deterministic server rule-output strings.',
        ),
        binding: 'not_bound',
      },
    ],
    [
      analysis.metrics.avgChargeLimitPct,
      analysis.metrics.originalCapacityKwh,
      analysis.metrics.reportedGrade,
      facts,
      formatDayKey,
      passport?.vin_masked,
      recommendationCount,
      t,
      thermal,
      trendCount, fmtNumber, fmtPercent, fmtInt, fmtScientificNumber,
    ],
  );
  const columns = useMemo<Column<ProvenanceRow>[]>(
    () => [
      {
        key: 'field',
        header: t(
          'batteryPassport.provenance.field',
          'Certificate fact',
        ),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono">
            {row.field}
          </Text>
        ),
      },
      {
        key: 'value',
        header: t(
          'batteryPassport.provenance.currentValue',
          'Current value',
        ),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono break-all">
            {row.value}
          </Text>
        ),
      },
      {
        key: 'source',
        header: t(
          'batteryPassport.provenance.source',
          'Source and meaning',
        ),
        render: (row) => <Text variant="bodySm">{row.source}</Text>,
      },
      {
        key: 'binding',
        header: t(
          'batteryPassport.provenance.bound',
          'Bound by v1 hash',
        ),
        visibleOnMobile: true,
        render: (row) => (
          <Badge
            variant={
              row.binding === 'not_bound' ? 'neutral' : 'success'
            }
          >
            {bindingLabels[row.binding]}
          </Badge>
        ),
      },
    ],
    [t, bindingLabels],
  );

  return (
    <section data-testid="battery-passport-provenance-matrix">
      <LayoutCard title={t(
            'batteryPassport.provenance.title',
            'Provenance core-facts matrix',
          )} description={t(
            'batteryPassport.provenance.subtitle',
            'Exactly seven facts enter the tsbp-v1 canonical string. Display and analysis fields outside that list are not protected by this digest.',
          )} actions={<Fingerprint className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}>
        <BatteryPassportSectionBody state={state}>
          <DataTable
            tableId="battery:passport-provenance"
            resizable={false}
            columnReorder={false}
            columnVisibility={false}
            name={t(
              'batteryPassport.provenance.title',
              'Provenance core-facts matrix',
            )}
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.field}
            mobilePresentation={{
              variant: 'keyValue',
              roles: { field: 'title', value: 'primary', source: 'meta', binding: 'badge' },
              displayValue: (row, key) => {
                if (key === 'binding') {
                  return bindingLabels[row.binding];
                }
                return key === 'field' || key === 'value' || key === 'source'
                  ? row[key]
                  : undefined;
              },
            }}
            density="compact"
            emptyMessage={t(
              'batteryPassport.provenance.empty',
              'No provenance facts are available.',
            )}
          />
        </BatteryPassportSectionBody>
      </LayoutCard>
    </section>
  );
}
