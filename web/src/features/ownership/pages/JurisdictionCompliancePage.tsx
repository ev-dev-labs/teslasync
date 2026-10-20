import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Globe2, Landmark, Stamp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useComplianceApportionment,
  useComplianceFilings,
  useCreateFiling,
  useCreateJurisdictionRate,
  useDeleteJurisdictionRate,
  useJurisdictionRates,
} from '@/api/hooks/useOwnership';
import { AlertBanner } from '@/components/feedback';
import { OperationalBrief } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Code, ConfirmDialog, DataTable, Icon, Input, Select, Text, useSortToggle, IconButton } from '@/components/ui';
import type { Column } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { downloadCSV, downloadJSON, objectsToCSV, type CsvCellValue } from '@/lib/csvExport';
import { neonColorMap, typography } from '@/lib/tokens';

import type {
  ComplianceFiling,
  JurisdictionApportionment,
  JurisdictionRate,
} from '@/types/ownership';
import {
  EvidencePanel,
  MoneyInput,
  MutationError,
  OwnershipPanel,
} from '../components';
import { complianceSummary } from '../components/statstrip-compliance/complianceSummaryMetrics';
import {
  formatCurrencyMinor,
  formatPct,
  formatPricePerDistance,
  fromDateInput,
} from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const WINDOW_OPTIONS = [30, 90, 180, 365];

function exportWorksheet(format: 'csv' | 'json', name: string, rows: Record<string, CsvCellValue>[]) {
  if (format === 'json') downloadJSON(name, rows);
  else downloadCSV(name, objectsToCSV(rows));
}

function validBusinessDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default function JurisdictionCompliancePage() {
  const { fmtInt, fmtNumber, fmtScientificNumber, precision, locale } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [windowDays, setWindowDays] = useState(90);
  const [rateOpen, setRateOpen] = useState(false);
  const [filingOpen, setFilingOpen] = useState(false);
  const [filingPaging, setFilingPaging] = useState({ vehicleId, limit: 50, offset: 0 });
  const filingOffset = filingPaging.vehicleId === vehicleId ? filingPaging.offset : 0;
  useEffect(() => {
    setFilingPaging((current) => current.vehicleId === vehicleId
      ? current : { ...current, vehicleId, offset: 0 });
  }, [vehicleId]);
  const apportionSort = useSortToggle();
  const filingSort = useSortToggle();
  const [rateSubmitted, setRateSubmitted] = useState(false);
  const [filingSubmitted, setFilingSubmitted] = useState(false);
  const rateFormId = useId();
  const filingFormId = useId();
  const [rateDraft, setRateDraft] = useState({
    jurisdiction_code: '',
    label: '',
    currency: 'USD',
    road_usage_minor_per_m: 0,
    registration_fee_minor: 0,
    grid_intensity_g_per_wh: 0.4,
    min_lat: 0,
    max_lat: 0,
    min_lng: 0,
    max_lng: 0,
  });
  const [filingDraft, setFilingDraft] = useState({
    period_start: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
    period_end: new Date().toISOString().slice(0, 10),
  });

  usePageTitle(t('ownership.compliance.navTitle', 'Jurisdictional compliance'));

  const reportQuery = useComplianceApportionment(vehicleId, windowDays);
  const ratesQuery = useJurisdictionRates();
  const filingsQuery = useComplianceFilings(vehicleId, filingPaging.limit, filingOffset);
  const createRate = useCreateJurisdictionRate();
  const deleteRate = useDeleteJurisdictionRate();
  const { confirm, dialogProps } = useConfirm();

  const handleRemove = async (row: JurisdictionRate) => {
    const ok = await confirm({
      title: t('ownership.compliance.delete.title', 'Delete this jurisdiction rate?'),
      message: t(
        'ownership.compliance.delete.message',
        'The “{{name}}” rate will be removed permanently. This cannot be undone.',
        { name: row.label },
      ),
      variant: 'danger',
      confirmLabel: t('common.delete', 'Delete'),
      cancelLabel: t('common.cancel', 'Cancel'),
    });
    if (ok) deleteRate.mutate(row.id);
  };
  const createFiling = useCreateFiling();

  const report = reportQuery.data;
  const reportState = useDataState(reportQuery, { provenance: 'historical' });
  const jurisdictions = useMemo(() => report?.jurisdictions ?? [], [report?.jurisdictions]);
  const rates = useMemo(() => ratesQuery.data?.items ?? [], [ratesQuery.data?.items]);
  const filings = useMemo(() => filingsQuery.data?.items ?? [], [filingsQuery.data?.items]);
  const liabilitySummary = complianceSummary(report, units.unitPrefs, precision, locale, t);
  const liabilityMetrics = useOperationalMetrics(liabilitySummary.metrics, liabilitySummary.preferences);
  const periodLabel = liabilitySummary.period.kind === 'analysis'
    ? `${formatDateTime(liabilitySummary.period.start, { locale, tz: 'UTC' })} → ${formatDateTime(liabilitySummary.period.endExclusive, { locale, tz: 'UTC' })}`
    : liabilitySummary.period.label;
  const sortedJurisdictions = useMemo(() => apportionSort.sortFn(jurisdictions, (row, key) => {
    if (key === 'distance') return row.distance_m;
    if (key === 'roadUsage') return row.road_usage_charge_minor;
    return row.total_liability_minor;
  }), [jurisdictions, apportionSort.sortFn]);
  // The endpoint has no sort parameter: period sorting is explicitly page-local.
  const sortedFilings = useMemo(() => filingSort.sortFn(filings, (row) => Date.parse(row.period_start)),
    [filings, filingSort.sortFn]);
  const reportedTotal = filingsQuery.data?.total;
  const filingTotal = reportedTotal != null && Number.isSafeInteger(reportedTotal) && reportedTotal >= 0
    ? reportedTotal : undefined;
  const filingLimit = filingsQuery.data && filingsQuery.data.limit > 0 ? filingsQuery.data.limit : filingPaging.limit;
  const returnedOffset = filingsQuery.data?.offset ?? filingOffset;
  const vehiclePrerequisite = t('signalLog.noVehicle', 'Select a vehicle to begin');
  const latitudeInvalid = !Number.isFinite(rateDraft.min_lat) || !Number.isFinite(rateDraft.max_lat)
    || rateDraft.min_lat < -90 || rateDraft.max_lat > 90 || rateDraft.min_lat > rateDraft.max_lat;
  const longitudeInvalid = !Number.isFinite(rateDraft.min_lng) || !Number.isFinite(rateDraft.max_lng)
    || rateDraft.min_lng < -180 || rateDraft.max_lng > 180 || rateDraft.min_lng > rateDraft.max_lng;
  const datesInvalid = !validBusinessDate(filingDraft.period_start)
    || !validBusinessDate(filingDraft.period_end) || filingDraft.period_start > filingDraft.period_end;
  const dateError = filingSubmitted && datesInvalid
    ? t('vehicleSettings.validation.invalidDate', 'Enter a valid date and time.') : undefined;

  const submitRate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRateSubmitted(true);
    if (latitudeInvalid || longitudeInvalid || !event.currentTarget.reportValidity()) return;
    createRate.mutate(rateDraft, { onSuccess: () => setRateOpen(false) });
  };

  const submitFiling = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilingSubmitted(true);
    if (vehicleId == null || datesInvalid || !event.currentTarget.reportValidity()) return;
    createFiling.mutate(
      {
        period_start: fromDateInput(filingDraft.period_start),
        period_end: fromDateInput(filingDraft.period_end),
        vehicle_id: vehicleId, confirmed: true,
      },
      { onSuccess: () => setFilingOpen(false) },
    );
  };

  const apportionColumns: Column<JurisdictionApportionment>[] = [
    {
      key: 'jurisdiction',
      header: t('ownership.compliance.row.jurisdiction', 'Jurisdiction'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Icon
            icon={Globe2}
            size="md"
            className={row.jurisdiction_code === 'UNASSIGNED' ? typography.color.muted : typography.color.secondary}
          />
          <div>
            <Text as="p" variant="label">
              {row.label}
            </Text>
            <Text as="p" variant="caption">
              {row.jurisdiction_code}
            </Text>
          </div>
        </div>
      ),
    },
    {
      key: 'distance',
      header: t('ownership.compliance.row.distance', 'Distance'),
      align: 'right',
      render: (row) => (
        <div>
          <span className="tabular-nums">{units.formatDistance(row.distance_m)}</span>
          <Text as="p" variant="caption">
            {formatPct(row.distance_share_pct)}
          </Text>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'drives',
      header: t('ownership.compliance.row.drives', 'Drives'),
      align: 'right',
      render: (row) => <span className="tabular-nums">{fmtInt(row.drive_count)}</span>,
    },
    {
      key: 'energy',
      header: t('ownership.compliance.row.energy', 'Energy'),
      align: 'right',
      render: (row) => <span className="tabular-nums">{units.formatEnergy(row.energy_wh)}</span>,
    },
    {
      key: 'roadUsage',
      header: t('ownership.compliance.row.roadUsage', 'Road-usage charge'),
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.road_usage_charge_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'registration',
      header: t('ownership.compliance.row.registration', 'Registration'),
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.registration_fee_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'liability',
      header: t('ownership.compliance.row.liability', 'Total liability'),
      align: 'right',
      render: (row) => (
        <span className={`tabular-nums ${neonColorMap.amber.text}`}>
          {formatCurrencyMinor(row.total_liability_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'emissions',
      header: t('ownership.compliance.row.emissions', 'Attributed emissions'),
      align: 'right',
      render: (row) => (
        <div>
          <span className="tabular-nums">{fmtNumber(row.emissions_g / 1000)} kg</span>
          <Text as="p" variant="caption">
            {row.emissions_g_per_m != null
              ? t('ownership.compliance.row.emissionsRate', '{{value}} g per km', {
                  value: fmtNumber(row.emissions_g_per_m * 1000),
                })
              : '—'}
          </Text>
        </div>
      ),
    },
    {
      key: 'confidence',
      header: t('ownership.compliance.row.confidence', 'Confidence'),
      align: 'right',
      render: (row) => (
        <span
          className={`tabular-nums ${row.confidence_pct >= 90 ? neonColorMap.green.text : row.confidence_pct >= 60 ? neonColorMap.amber.text : neonColorMap.red.text}`}
        >
          {formatPct(row.confidence_pct)}
        </span>
      ),
    },
  ];

  const rateColumns: Column<JurisdictionRate>[] = [
    {
      key: 'code',
      filterValue: (row) => row.jurisdiction_code,
      filterValueLabel: (_value, row) => `${row.label} · ${row.jurisdiction_code}`,
      header: t('ownership.compliance.rate.code', 'Jurisdiction'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.label}
          </Text>
          <Text as="p" variant="caption">
            {row.jurisdiction_code}
          </Text>
        </div>
      ),
    },
    {
      key: 'roadUsage',
      header: t('ownership.compliance.rate.roadUsage', 'Road-usage rate'),
      align: 'right',
      filterValue: (row) => `${row.currency}:${row.road_usage_minor_per_m}`,
      filterValueLabel: (_value, row) => formatPricePerDistance(row.road_usage_minor_per_m, row.currency, units.unitPrefs, units.unitPrefs.locale),
      render: (row) => (
        <span className="tabular-nums">
          {formatPricePerDistance(
            row.road_usage_minor_per_m,
            row.currency,
            units.unitPrefs,
            units.unitPrefs.locale,
          )}
        </span>
      ),
    },
    {
      key: 'registration',
      header: t('ownership.compliance.rate.registration', 'Annual registration'),
      align: 'right',
      filterValue: (row) => `${row.currency}:${row.registration_fee_minor}`,
      filterValueLabel: (_value, row) => formatCurrencyMinor(row.registration_fee_minor, row.currency, units.unitPrefs.locale),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.registration_fee_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'grid',
      align: 'right',
      filterValue: (row) => row.grid_intensity_g_per_wh,
      filterValueLabel: (_value, row) => `${fmtNumber(row.grid_intensity_g_per_wh * 1000)} g/kWh`,
      header: t('ownership.compliance.rate.grid', 'Grid intensity'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtNumber(row.grid_intensity_g_per_wh * 1000)} g/kWh
        </span>
      ),
    },
    {
      key: 'bbox',
      header: t('ownership.compliance.rate.bbox', 'Bounding box'),
      render: (row) => (
        <Text as="span" variant="caption">
          {fmtScientificNumber(row.min_lat, 3)},{fmtScientificNumber(row.min_lng, 3)} → {fmtScientificNumber(row.max_lat, 3)},
          {fmtScientificNumber(row.max_lng, 3)}
        </Text>
      ),
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        /* confirm-step: handleRemove asks in the shared ConfirmDialog before removing */
        <IconButton icon={<Icon icon={Trash2} size="md" />} label={t('ownership.action.remove', 'Remove')} onClick={() => void handleRemove(row)} busy={deleteRate.isPending && deleteRate.variables === row.id} />
      ),
    },
  ];

  const filingColumns: Column<ComplianceFiling>[] = [
    {
      key: 'period',
      header: t('ownership.compliance.filing.period', 'Period'),
      render: (row) => (
        <Text as="span" variant="caption">
          {formatDateTime(row.period_start, { locale })} → {formatDateTime(row.period_end, { locale })}
        </Text>
      ),
      sortable: true,
    },
    {
      key: 'distance',
      header: t('ownership.compliance.filing.distance', 'Distance'),
      align: 'right',
      render: (row) => <span className="tabular-nums">{units.formatDistance(row.total_distance_m)}</span>,
    },
    {
      key: 'energy',
      header: t('ownership.compliance.filing.energy', 'Energy'),
      align: 'right',
      render: (row) => <span className="tabular-nums">{units.formatEnergy(row.total_energy_wh)}</span>,
    },
    {
      key: 'charge',
      header: t('ownership.compliance.filing.charge', 'Charge'),
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.total_charge_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('ownership.compliance.filing.status', 'Status'),
      render: (row) => <Badge variant="info">{row.status}</Badge>,
    },
    {
      key: 'digest',
      header: t('ownership.compliance.filing.digest', 'Seal'),
      render: (row) => (
        <Code className={`break-all ${typography.color.secondary}`} title={row.digest}>{row.digest.slice(0, 16)}…</Code>
      ),
    },
  ];

  return (
    <PageLayout
      title={t('ownership.compliance.title', 'Jurisdictional compliance & road-usage charge')}
      subtitle={t(
        'ownership.compliance.subtitle',
        'Apportion every metre you drove to the jurisdiction it happened in, price it against that jurisdiction’s road-usage rate, and seal the period into an immutable filing record.',
      )}
      query={[reportQuery, ratesQuery, filingsQuery]}
      contextActions={
        <div className="flex items-center gap-2">
          <Select
            aria-label={t('ownership.window.label', 'Analysis window')}
            value={String(windowDays)}
            options={WINDOW_OPTIONS.map((days) => ({
              value: String(days),
              label: t('ownership.window.days', '{{count}} days', { count: days }),
            }))}
            onChange={(event) => setWindowDays(Number(event.target.value))}
          />
        </div>
      }
    >
      <AlertBanner
        variant="warning"
        title={t('ownership.compliance.notice.title', 'A worksheet, not a tax return')}
      >
        {t(
          'ownership.compliance.notice.body',
          'Rates are the ones you enter; boundaries are simple bounding boxes. A drive that starts in one jurisdiction and ends in another is split evenly and flagged at reduced confidence. Use this to prepare and cross-check a filing — never as the filing itself.',
        )}
      </AlertBanner>

      <FadeIn>
        <OwnershipPanel title={t('ownership.compliance.summary.title', 'Period liability')}
          source={reportQuery} sourceEnabled={vehicleId != null} empty={!report}
          emptyMessage={vehicleId == null ? vehiclePrerequisite : undefined} preserveSummary>
          <OperationalBrief
            compact
            testId="compliance-period-liability"
            eyebrow={t('ownership.compliance.navTitle', 'Jurisdictional compliance')}
            title={t('ownership.compliance.brief.title', 'Recorded period liability')}
            description={t('ownership.compliance.brief.description', 'Distance, road-usage liability and attributed emissions for the recorded apportionment window.')}
            metrics={liabilityMetrics}
            scope={periodLabel}
            provenance={liabilitySummary.period.kind === 'unknown'
              ? liabilitySummary.period.reason : liabilitySummary.period.provenance}
            statusLabel={reportState.status === 'stale'
              ? t('dataState.stale.title', 'Data may be stale')
              : report ? t('ownership.compliance.brief.recorded', 'Recorded apportionment')
                : t('common.unknown', 'Unknown')}
            statusTone={reportState.status === 'stale' ? 'warning' : 'neutral'}
            freshness={reportState.updatedAt != null
              ? formatDateTime(new Date(reportState.updatedAt).toISOString(), { locale }) : undefined}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.compliance.apportion.title', 'Apportionment by jurisdiction')}
          source={reportQuery}
          sourceEnabled={vehicleId != null}
          description={t(
            'ownership.compliance.apportion.subtitle',
            'Confidence is 95% when both endpoints fall in the same box, 70% when only one does, and 60% for a cross-border split.',
          )}
          empty={jurisdictions.length === 0}
          emptyMessage={vehicleId == null ? vehiclePrerequisite : t(
            'ownership.compliance.apportion.empty',
            'No drives with usable coordinates in this window.',
          )}
        >
          <DataTable
            columns={apportionColumns}
            mobileColumns={['jurisdiction', 'liability', 'confidence']}
            mobilePresentation={{
              roles: { jurisdiction: 'title', liability: 'primary', distance: 'meta', confidence: 'meta' },
              displayValue: (row, key) => {
                if (key === 'jurisdiction') return row.label;
                if (key === 'liability') return formatCurrencyMinor(row.total_liability_minor, row.currency, units.unitPrefs.locale);
                if (key === 'distance') return units.formatDistance(row.distance_m);
                if (key === 'confidence') return formatPct(row.confidence_pct);
                return null;
              },
            }}
            data={sortedJurisdictions}
            sortKey={apportionSort.sortKey}
            sortDir={apportionSort.sortDir}
            onSort={apportionSort.onSort}
            onExport={(format, rows) => exportWorksheet(format, 'jurisdiction-apportionment-worksheet', rows.map((row) => ({
              ...row,
              distance_display: units.formatDistance(row.distance_m),
              energy_display: units.formatEnergy(row.energy_wh),
              liability_display: formatCurrencyMinor(row.total_liability_minor, row.currency, locale),
            })))}
            keyExtractor={(row) => row.jurisdiction_code}
            tableId="ownership-compliance-apportion"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.compliance.rates.title', 'Jurisdiction rate table')}
          source={ratesQuery}
          editing={rateOpen}
          description={t(
            'ownership.compliance.rates.subtitle',
            'When boxes overlap, the smallest one that contains the point wins — so a city can sit inside a state.',
          )}
          empty={rates.length === 0 && !rateOpen}
          emptyMessage={t('ownership.compliance.rates.empty', 'No jurisdiction rates defined yet.')}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon icon={Landmark} size="md" />}
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
              wrapLabel
              aria-expanded={rateOpen}
              aria-controls={rateFormId}
              onClick={() => setRateOpen((open) => !open)}
            >
              {rateOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.compliance.rates.add', 'Add jurisdiction')}
            </Button>
          }
        >
          {rateOpen ? (
            <form id={rateFormId} className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4" noValidate onSubmit={submitRate}>
              <Input
                label={t('ownership.compliance.rateForm.code', 'Jurisdiction code')}
                value={rateDraft.jurisdiction_code}
                required
                maxLength={32}
                hint={t('ownership.compliance.rateForm.codeHint', 'e.g. US-WA')}
                onChange={(event) =>
                  setRateDraft((current) => ({
                    ...current,
                    jurisdiction_code: event.target.value.toUpperCase(),
                  }))
                }
              />
              <Input
                label={t('ownership.compliance.rateForm.label', 'Display name')}
                value={rateDraft.label}
                required
                maxLength={160}
                onChange={(event) =>
                  setRateDraft((current) => ({ ...current, label: event.target.value }))
                }
              />
              <Input
                label={t('ownership.form.currency', 'ISO currency code')}
                value={rateDraft.currency}
                minLength={3}
                maxLength={3}
                required
                onChange={(event) =>
                  setRateDraft((current) => ({
                    ...current,
                    currency: event.target.value.toUpperCase(),
                  }))
                }
              />
              <Input
                type="number"
                label={t('ownership.compliance.rateForm.roadUsage', 'Road-usage rate (minor / m)')}
                value={rateDraft.road_usage_minor_per_m}
                step="any"
                min={0}
                required
                hint={formatPricePerDistance(
                  rateDraft.road_usage_minor_per_m,
                  rateDraft.currency,
                  units.unitPrefs,
                  units.unitPrefs.locale,
                )}
                onChange={(event) =>
                  setRateDraft((current) => ({
                    ...current,
                    road_usage_minor_per_m: Number(event.target.value),
                  }))
                }
              />
              <MoneyInput
                label={t('ownership.compliance.rateForm.registration', 'Annual registration')}
                value={rateDraft.registration_fee_minor}
                currency={rateDraft.currency}
                locale={units.unitPrefs.locale}
                onChange={(value) =>
                  setRateDraft((current) => ({ ...current, registration_fee_minor: value ?? 0 }))
                }
              />
              <Input
                type="number"
                label={t('ownership.compliance.rateForm.grid', 'Grid intensity (g CO₂e / Wh)')}
                value={rateDraft.grid_intensity_g_per_wh}
                step="any"
                min={0}
                hint={t('ownership.compliance.rateForm.gridHint', '{{value}} g per kWh', {
                  value: fmtNumber(rateDraft.grid_intensity_g_per_wh * 1000),
                })}
                onChange={(event) =>
                  setRateDraft((current) => ({
                    ...current,
                    grid_intensity_g_per_wh: Number(event.target.value),
                  }))
                }
              />
              <Input
                type="number"
                label={t('ownership.compliance.rateForm.minLat', 'Min latitude')}
                value={rateDraft.min_lat}
                step="any"
                min={-90}
                max={90}
                error={rateSubmitted && latitudeInvalid ? t('geofences.validation.latitudeRange', 'Latitude must be between {{min}} and {{max}}', { min: -90, max: rateDraft.max_lat }) : undefined}
                required
                onChange={(event) =>
                  setRateDraft((current) => ({ ...current, min_lat: Number(event.target.value) }))
                }
              />
              <Input
                type="number"
                label={t('ownership.compliance.rateForm.maxLat', 'Max latitude')}
                value={rateDraft.max_lat}
                step="any"
                min={-90}
                max={90}
                error={rateSubmitted && latitudeInvalid ? t('geofences.validation.latitudeRange', 'Latitude must be between {{min}} and {{max}}', { min: rateDraft.min_lat, max: 90 }) : undefined}
                required
                onChange={(event) =>
                  setRateDraft((current) => ({ ...current, max_lat: Number(event.target.value) }))
                }
              />
              <Input
                type="number"
                label={t('ownership.compliance.rateForm.minLng', 'Min longitude')}
                value={rateDraft.min_lng}
                step="any"
                min={-180}
                max={180}
                error={rateSubmitted && longitudeInvalid ? t('geofences.validation.longitudeRange', 'Longitude must be between {{min}} and {{max}}', { min: -180, max: rateDraft.max_lng }) : undefined}
                required
                onChange={(event) =>
                  setRateDraft((current) => ({ ...current, min_lng: Number(event.target.value) }))
                }
              />
              <Input
                type="number"
                label={t('ownership.compliance.rateForm.maxLng', 'Max longitude')}
                value={rateDraft.max_lng}
                step="any"
                min={-180}
                max={180}
                error={rateSubmitted && longitudeInvalid ? t('geofences.validation.longitudeRange', 'Longitude must be between {{min}} and {{max}}', { min: rateDraft.min_lng, max: 180 }) : undefined}
                required
                onChange={(event) =>
                  setRateDraft((current) => ({ ...current, max_lng: Number(event.target.value) }))
                }
              />
              <div className="md:col-span-2 xl:col-span-4">
                <Button type="submit" loading={createRate.isPending} className="min-h-11" wrapLabel>
                  {t('ownership.compliance.rateForm.save', 'Save jurisdiction')}
                </Button>
                <MutationError error={createRate.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={rateColumns}
            enableValueFilters
            mobileColumns={['code', 'roadUsage', 'registration']}
            mobilePresentation={{
              roles: { code: 'title', roadUsage: 'primary', registration: 'meta', grid: 'meta' },
              displayValue: (row, key) => {
                if (key === 'code') return row.label;
                if (key === 'roadUsage') return formatPricePerDistance(row.road_usage_minor_per_m, row.currency, units.unitPrefs, units.unitPrefs.locale);
                if (key === 'registration') return formatCurrencyMinor(row.registration_fee_minor, row.currency, units.unitPrefs.locale);
                if (key === 'grid') return `${fmtNumber(row.grid_intensity_g_per_wh * 1000)} g/kWh`;
                return null;
              },
              inlineActions: (row) => rateColumns.find((column) => column.key === 'actions')?.render(row),
            }}
            data={rates}
            onExport={(format, rows) => exportWorksheet(format, 'jurisdiction-rates-worksheet', rows.map((row) => ({
              ...row,
              road_usage_display: formatPricePerDistance(row.road_usage_minor_per_m, row.currency, units.unitPrefs, locale),
              registration_display: formatCurrencyMinor(row.registration_fee_minor, row.currency, locale),
            })))}
            keyExtractor={(row) => row.id}
            tableId="ownership-compliance-rates"
            emptyMessage={t(
              'ownership.compliance.rates.empty',
              'No jurisdiction rates defined yet.',
            )}
          />
          <MutationError error={deleteRate.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.compliance.filings.title', 'Sealed filings')}
          source={filingsQuery}
          sourceEnabled={vehicleId != null}
          editing={filingOpen}
          description={t(
            'ownership.compliance.filings.subtitle',
            'Sealing a period snapshots the distance, energy and charge behind a digest, so a later dispute can be settled against the exact figures you filed.',
          )}
          empty={filings.length === 0 && !filingOpen && !(filingTotal != null && filingTotal > 0)}
          emptyMessage={vehicleId == null ? vehiclePrerequisite : t('ownership.compliance.filings.empty', 'No periods sealed yet.')}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon icon={Stamp} size="md" />}
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
              wrapLabel
              aria-expanded={filingOpen}
              aria-controls={filingFormId}
              disabled={vehicleId == null}
              aria-describedby={filingOpen && vehicleId == null ? `${filingFormId}-prerequisite` : undefined}
              onClick={() => setFilingOpen((open) => !open)}
            >
              {filingOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.compliance.filings.add', 'Seal a period')}
            </Button>
          }
        >
          {filingOpen ? (
            <form id={filingFormId} className="mb-6 grid gap-4 md:grid-cols-3" noValidate onSubmit={submitFiling}>
              {vehicleId == null && <Text id={`${filingFormId}-prerequisite`} variant="helper" className="md:col-span-3">{vehiclePrerequisite}</Text>}
              <Input
                type="date"
                label={t('ownership.compliance.filingForm.start', 'Period start')}
                value={filingDraft.period_start}
                max={filingDraft.period_end || undefined}
                error={dateError}
                required
                onChange={(event) =>
                  setFilingDraft((current) => ({
                    ...current,
                    period_start: event.target.value,
                  }))
                }
              />
              <Input
                type="date"
                label={t('ownership.compliance.filingForm.end', 'Period end')}
                value={filingDraft.period_end}
                min={filingDraft.period_start || undefined}
                error={dateError}
                required
                onChange={(event) =>
                  setFilingDraft((current) => ({
                    ...current,
                    period_end: event.target.value,
                  }))
                }
              />
              <div className="flex items-end">
                <Button type="submit" loading={createFiling.isPending} disabled={vehicleId == null}
                  aria-describedby={vehicleId == null ? `${filingFormId}-prerequisite` : undefined} className="min-h-11" wrapLabel>
                  {t('ownership.compliance.filingForm.submit', 'Seal period')}
                </Button>
              </div>
              <div className="md:col-span-3">
                <MutationError error={createFiling.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={filingColumns}
            mobileColumns={['period', 'status', 'charge']}
            mobilePresentation={{
              roles: { period: 'title', charge: 'primary', status: 'meta' },
              displayValue: (row, key) => {
                if (key === 'period') return `${formatDateTime(row.period_start, { locale })} → ${formatDateTime(row.period_end, { locale })}`;
                if (key === 'charge') return formatCurrencyMinor(row.total_charge_minor, row.currency, units.unitPrefs.locale);
                if (key === 'status') return row.status;
                return null;
              },
            }}
            data={sortedFilings}
            sortKey={filingSort.sortKey}
            sortDir={filingSort.sortDir}
            onSort={filingSort.onSort}
            exportable
            onExport={(format, rows) => exportWorksheet(format, 'jurisdiction-filings-worksheet', rows.map((row) => ({
              ...row,
              period_display: `${formatDateTime(row.period_start, { locale })} → ${formatDateTime(row.period_end, { locale })}`,
              distance_display: units.formatDistance(row.total_distance_m),
              energy_display: units.formatEnergy(row.total_energy_wh),
              charge_display: formatCurrencyMinor(row.total_charge_minor, row.currency, locale),
            })))}
            paginationControls={{
              page: Math.floor(returnedOffset / filingLimit) + 1,
              pageSize: filingLimit,
              total: filingTotal ?? 0,
              totalKind: filingTotal == null ? 'unknown' : 'exact',
              onPageChange: (page) => setFilingPaging({ vehicleId, limit: filingLimit, offset: (page - 1) * filingLimit }),
              onPageSizeChange: (limit) => setFilingPaging({ vehicleId, limit, offset: 0 }),
            }}
            keyExtractor={(row) => row.id}
            tableId="ownership-compliance-filings"
            emptyMessage={t('ownership.compliance.filings.empty', 'No periods sealed yet.')}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel title={t('ownership.compliance.digest.title', 'Period digest')}
          source={reportQuery} sourceEnabled={vehicleId != null} empty={!report}
          emptyMessage={vehicleId == null ? vehiclePrerequisite : undefined}>
          <Text as="p" variant="caption">
            {t(
              'ownership.compliance.digest.body',
              'A stable fingerprint of the apportionment above. If the underlying drives change, the digest changes — which is exactly what makes a sealed filing meaningful.',
            )}
          </Text>
          <Code className={`mt-2 block break-all ${typography.color.secondary}`}>{report?.digest || '—'}</Code>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <EvidencePanel
          source={reportQuery}
          sourceEnabled={vehicleId != null}
          quality={report?.quality}
          evidence={report?.evidence}
          unsupported={[
            t(
              'ownership.compliance.unsupported.polygon',
              'True polygon boundaries — jurisdictions are approximated by bounding boxes',
            ),
            t(
              'ownership.compliance.unsupported.submit',
              'Submitting to a tax authority, and any legal interpretation of what is owed',
            ),
          ]}
        />
      </FadeIn>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </PageLayout>
  );
}
