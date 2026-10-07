import { useMemo } from 'react';
import { Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type { BatteryPassportAnalysis } from '../../lib/batteryPassportAnalysis';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';

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
  const { t } = useTranslation();
  const passport = state.passport;
  const facts = analysis.hashFacts;
  const thermal = analysis.thermal.sumPct;
  const trendCount = Array.isArray(passport?.degradation_trend)
    ? passport.degradation_trend.length
    : 0;
  const recommendationCount = Array.isArray(passport?.recommendations)
    ? passport.recommendations.length
    : 0;
  const rows = useMemo<ProvenanceRow[]>(
    () => [
      {
        field: t(
          'batteryPassport.provenance.vehicleId',
          'vehicle_id',
        ),
        value: facts.vehicleId != null
          ? fmtNumber(facts.vehicleId, 0)
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
        value: facts.firstObservedDay ?? '—',
        source: t(
          'batteryPassport.provenance.firstObservedSource',
          'Earliest observed charging or drive day in UTC; absence canonicalizes to 0001-01-01.',
        ),
        binding: 'utc_day',
      },
      {
        field: t('batteryPassport.provenance.soh', 'soh_pct'),
        value: facts.sohPct != null
          ? fmtNumber(facts.sohPct, 4)
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
          ? fmtNumber(facts.capacityKwh, 4)
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
          ? fmtNumber(facts.equivalentFullCycles, 4)
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
          ? fmtNumber(facts.fastChargeRatio, 4)
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
        value: facts.issuedAtDay ?? '—',
        source: t(
          'batteryPassport.provenance.issuedSource',
          'Certificate issue day in UTC, not the full issue instant.',
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
          ? fmtNumber(analysis.metrics.originalCapacityKwh, 1)
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
          ? fmtPercent(analysis.metrics.avgChargeLimitPct, 1)
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
        value: thermal != null ? fmtPercent(thermal, 1) : '—',
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
          'Returned UTC daily SoH estimates.',
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
      passport?.vin_masked,
      recommendationCount,
      t,
      thermal,
      trendCount,
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
            {row.binding === 'utc_day'
              ? t(
                  'batteryPassport.provenance.utcDay',
                  'Yes, UTC day',
                )
              : row.binding === 'value'
                ? t(
                    'batteryPassport.provenance.yes',
                    'Yes',
                  )
                : t(
                    'batteryPassport.provenance.no',
                    'No',
                  )}
          </Badge>
        ),
      },
    ],
    [t],
  );

  return (
    <section data-testid="battery-passport-provenance-matrix">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Fingerprint
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.provenance.title',
            'Provenance core-facts matrix',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.provenance.subtitle',
            'Exactly seven facts enter the tsbp-v1 canonical string. Display and analysis fields outside that list are not protected by this digest.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <DataTable
            tableId="battery:passport-provenance"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.field}
            mobileColumns={['field', 'value', 'binding']}
            density="compact"
            emptyMessage={t(
              'batteryPassport.provenance.empty',
              'No provenance facts are available.',
            )}
          />
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}
