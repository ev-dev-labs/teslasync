import { useMemo } from 'react';
import { ListTree } from 'lucide-react';
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

interface BatteryPassportFieldDirectoryProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
}

interface FieldRow {
  field: string;
  summary: string;
  source: string;
  binding: 'value' | 'utc_day' | 'not_bound' | 'digest';
}

function finiteSummary(
  value: unknown,
  decimals: number,
): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? fmtNumber(value, decimals)
    : '—';
}

export function BatteryPassportFieldDirectory({
  analysis,
  state,
}: BatteryPassportFieldDirectoryProps) {
  const { t } = useTranslation();
  const passport = state.passport;
  const rawTrend = Array.isArray(passport?.degradation_trend)
    ? passport.degradation_trend
    : [];
  const rawRecommendations = Array.isArray(passport?.recommendations)
    ? passport.recommendations
    : [];
  const rows = useMemo<FieldRow[]>(
    () => [
      {
        field: t('batteryPassport.fields.vehicleId', 'vehicle_id'),
        summary: finiteSummary(passport?.vehicle_id, 0),
        source: t(
          'batteryPassport.fields.vehicleIdSource',
          'Vehicle database identity used to scope every server read.',
        ),
        binding: 'value',
      },
      {
        field: t('batteryPassport.fields.vin', 'vin_masked'),
        summary: passport?.vin_masked || '—',
        source: t(
          'batteryPassport.fields.vinSource',
          'Masked VIN display derived by the server.',
        ),
        binding: 'not_bound',
      },
      {
        field: t('batteryPassport.fields.issued', 'issued_at'),
        summary: passport?.issued_at || '—',
        source: t(
          'batteryPassport.fields.issuedSource',
          'RFC 3339 server issue instant; only its UTC day enters the v1 hash.',
        ),
        binding: 'utc_day',
      },
      {
        field: t(
          'batteryPassport.fields.firstObserved',
          'first_observed_at',
        ),
        summary: passport?.first_observed_at ?? '—',
        source: t(
          'batteryPassport.fields.firstObservedSource',
          'Earliest charging or drive instant, nullable; only the UTC day enters the v1 hash.',
        ),
        binding: 'utc_day',
      },
      {
        field: t('batteryPassport.fields.soh', 'soh_pct'),
        summary: finiteSummary(passport?.soh_pct, 1),
        source: t(
          'batteryPassport.fields.sohSource',
          'Server-derived estimate from reported capacity and the server-selected reference.',
        ),
        binding: 'value',
      },
      {
        field: t(
          'batteryPassport.fields.capacity',
          'capacity_kwh',
        ),
        summary: finiteSummary(passport?.capacity_kwh, 2),
        source: t(
          'batteryPassport.fields.capacitySource',
          'Median-derived reported capacity estimate in kWh.',
        ),
        binding: 'value',
      },
      {
        field: t(
          'batteryPassport.fields.originalCapacity',
          'original_capacity_kwh',
        ),
        summary: finiteSummary(
          passport?.original_capacity_kwh,
          1,
        ),
        source: t(
          'batteryPassport.fields.originalCapacitySource',
          'Server nameplate reference selected from VIN, model, or fallback logic.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.efc',
          'equivalent_full_cycles',
        ),
        summary: finiteSummary(
          passport?.equivalent_full_cycles,
          1,
        ),
        source: t(
          'batteryPassport.fields.efcSource',
          'Total charged energy divided by the server-selected reference capacity.',
        ),
        binding: 'value',
      },
      {
        field: t(
          'batteryPassport.fields.fastRatio',
          'fast_charge_ratio',
        ),
        summary:
          typeof passport?.fast_charge_ratio === 'number'
          && Number.isFinite(passport.fast_charge_ratio)
            ? fmtPercent(passport.fast_charge_ratio * 100, 2)
            : '—',
        source: t(
          'batteryPassport.fields.fastRatioSource',
          'Share of counted charging sessions above the server fast-charge threshold.',
        ),
        binding: 'value',
      },
      {
        field: t(
          'batteryPassport.fields.avgLimit',
          'avg_charge_limit_pct',
        ),
        summary:
          typeof passport?.avg_charge_limit_pct === 'number'
          && Number.isFinite(passport.avg_charge_limit_pct)
            ? fmtPercent(passport.avg_charge_limit_pct, 1)
            : '—',
        source: t(
          'batteryPassport.fields.avgLimitSource',
          'Average available end_soc_pct across charging sessions.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.thermal',
          'thermal_exposure',
        ),
        summary: analysis.thermal.sumPct != null
          ? t(
              'batteryPassport.fields.thermalSummary',
              '{{sum}} total across 3 bands',
              { sum: fmtPercent(analysis.thermal.sumPct, 1) },
            )
          : '—',
        source: t(
          'batteryPassport.fields.thermalSource',
          'Object of ambient-temperature drive shares.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.thermalCold',
          'thermal_exposure.cold_pct',
        ),
        summary: finiteSummary(
          passport?.thermal_exposure?.cold_pct,
          1,
        ),
        source: t(
          'batteryPassport.fields.thermalColdSource',
          'Share of drives whose average ambient reading was below 10°C.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.thermalNominal',
          'thermal_exposure.nominal_pct',
        ),
        summary: finiteSummary(
          passport?.thermal_exposure?.nominal_pct,
          1,
        ),
        source: t(
          'batteryPassport.fields.thermalNominalSource',
          'Share of drives whose average ambient reading was 10°C through 30°C.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.thermalHot',
          'thermal_exposure.hot_pct',
        ),
        summary: finiteSummary(
          passport?.thermal_exposure?.hot_pct,
          1,
        ),
        source: t(
          'batteryPassport.fields.thermalHotSource',
          'Share of drives whose average ambient reading was above 30°C.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.grade',
          'health_grade',
        ),
        summary: passport?.health_grade || '—',
        source: t(
          'batteryPassport.fields.gradeSource',
          'Certificate-reported grade from the server scoring rule.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.trend',
          'degradation_trend',
        ),
        summary: t(
          'batteryPassport.fields.trendSummary',
          '{{count}} returned objects',
          { count: rawTrend.length },
        ),
        source: t(
          'batteryPassport.fields.trendSource',
          'Up to 180 qualifying daily aggregate estimates.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.trendDate',
          'degradation_trend[].date',
        ),
        summary: analysis.trend.points.length > 0
          ? t(
              'batteryPassport.fields.trendDateSummary',
              '{{first}} through {{last}} UTC',
              {
                first: analysis.trend.points[0]?.date ?? '—',
                last:
                  analysis.trend.points[
                    analysis.trend.points.length - 1
                  ]?.date ?? '—',
              },
            )
          : '—',
        source: t(
          'batteryPassport.fields.trendDateSource',
          'YYYY-MM-DD calendar day explicitly defined as UTC.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.trendSoh',
          'degradation_trend[].soh_pct',
        ),
        summary: t(
          'batteryPassport.fields.trendSohSummary',
          '{{count}} included finite values',
          { count: analysis.trend.diagnostics.pointCount },
        ),
        source: t(
          'batteryPassport.fields.trendSohSource',
          'Daily server-derived SoH estimate.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.recommendations',
          'recommendations',
        ),
        summary: t(
          'batteryPassport.fields.recommendationsSummary',
          '{{count}} strings',
          { count: rawRecommendations.length },
        ),
        source: t(
          'batteryPassport.fields.recommendationsSource',
          'Ordered deterministic server rule outputs.',
        ),
        binding: 'not_bound',
      },
      {
        field: t(
          'batteryPassport.fields.hash',
          'provenance_hash',
        ),
        summary: passport?.provenance_hash
          ? `${passport.provenance_hash.slice(0, 16)}…`
          : '—',
        source: t(
          'batteryPassport.fields.hashSource',
          'Lowercase SHA-256 digest derived from the seven v1 core facts.',
        ),
        binding: 'digest',
      },
    ],
    [
      analysis.thermal.sumPct,
      analysis.trend.diagnostics.pointCount,
      analysis.trend.points,
      passport,
      rawRecommendations.length,
      rawTrend.length,
      t,
    ],
  );
  const columns = useMemo<Column<FieldRow>[]>(
    () => [
      {
        key: 'field',
        header: t(
          'batteryPassport.fields.field',
          'Response field',
        ),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono">
            {row.field}
          </Text>
        ),
      },
      {
        key: 'summary',
        header: t(
          'batteryPassport.fields.summary',
          'Current summary',
        ),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono break-all">
            {row.summary}
          </Text>
        ),
      },
      {
        key: 'source',
        header: t(
          'batteryPassport.fields.source',
          'Source and meaning',
        ),
        render: (row) => <Text variant="bodySm">{row.source}</Text>,
      },
      {
        key: 'binding',
        header: t(
          'batteryPassport.fields.binding',
          'v1 hash relationship',
        ),
        render: (row) => (
          <Badge
            variant={
              row.binding === 'value' || row.binding === 'utc_day'
                ? 'success'
                : 'neutral'
            }
          >
            {row.binding === 'value'
              ? t(
                  'batteryPassport.fields.boundValue',
                  'Bound value',
                )
              : row.binding === 'utc_day'
                ? t(
                    'batteryPassport.fields.boundDay',
                    'Bound UTC day',
                  )
                : row.binding === 'digest'
                  ? t(
                      'batteryPassport.fields.digest',
                      'Digest output',
                    )
                  : t(
                      'batteryPassport.fields.notBound',
                      'Not bound',
                    )}
          </Badge>
        ),
      },
    ],
    [t],
  );

  return (
    <section data-testid="battery-passport-field-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListTree
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.fields.title',
            'Certificate field directory',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.fields.subtitle',
            'Every top-level response field plus nested thermal and trend fields, with source, meaning, and hash relationship.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <DataTable
            tableId="battery:passport-fields"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.field}
            mobileColumns={['field', 'summary']}
            density="compact"
            emptyMessage={t(
              'batteryPassport.fields.empty',
              'No certificate field metadata is available.',
            )}
          />
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}
