import { type FormEvent, useMemo, useState } from 'react';
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
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, DataTable, Input, Select, Text } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
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
  StatGrid,
} from '../components';
import {
  formatCurrencyMinor,
  formatPct,
  formatPricePerDistance,
  fromDateInput,
  toDateInput,
} from '../formatters';

const WINDOW_OPTIONS = [30, 90, 180, 365];

export default function JurisdictionCompliancePage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [windowDays, setWindowDays] = useState(90);
  const [rateOpen, setRateOpen] = useState(false);
  const [filingOpen, setFilingOpen] = useState(false);
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
    period_start: new Date(Date.now() - 90 * 86400000).toISOString(),
    period_end: new Date().toISOString(),
  });

  usePageTitle(t('ownership.compliance.navTitle', 'Jurisdictional Compliance'));

  const reportQuery = useComplianceApportionment(vehicleId, windowDays);
  const ratesQuery = useJurisdictionRates();
  const filingsQuery = useComplianceFilings(vehicleId, 50, 0);
  const createRate = useCreateJurisdictionRate();
  const deleteRate = useDeleteJurisdictionRate();
  const createFiling = useCreateFiling();

  const report = reportQuery.data;
  const jurisdictions = useMemo(() => report?.jurisdictions ?? [], [report?.jurisdictions]);
  const rates = useMemo(() => ratesQuery.data?.items ?? [], [ratesQuery.data?.items]);
  const filings = useMemo(() => filingsQuery.data?.items ?? [], [filingsQuery.data?.items]);
  const currency = report?.currency ?? rateDraft.currency;

  const submitRate = (event: FormEvent) => {
    event.preventDefault();
    createRate.mutate(rateDraft, { onSuccess: () => setRateOpen(false) });
  };

  const submitFiling = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    createFiling.mutate(
      { ...filingDraft, vehicle_id: vehicleId, confirmed: true },
      { onSuccess: () => setFilingOpen(false) },
    );
  };

  const apportionColumns: Column<JurisdictionApportionment>[] = [
    {
      key: 'jurisdiction',
      header: t('ownership.compliance.row.jurisdiction', 'Jurisdiction'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Globe2
            className={`h-4 w-4 ${row.jurisdiction_code === 'UNASSIGNED' ? 'text-[var(--text-muted)]' : 'text-cyan-300'}`}
            aria-hidden="true"
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
      render: (row) => <span className="tabular-nums">{fmtNumber(row.drive_count, 0)}</span>,
    },
    {
      key: 'energy',
      header: t('ownership.compliance.row.energy', 'Energy'),
      render: (row) => <span className="tabular-nums">{units.formatEnergy(row.energy_wh)}</span>,
    },
    {
      key: 'roadUsage',
      header: t('ownership.compliance.row.roadUsage', 'Road-usage charge'),
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
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.registration_fee_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'liability',
      header: t('ownership.compliance.row.liability', 'Total liability'),
      render: (row) => (
        <span className="tabular-nums text-amber-300">
          {formatCurrencyMinor(row.total_liability_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'emissions',
      header: t('ownership.compliance.row.emissions', 'Attributed emissions'),
      render: (row) => (
        <div>
          <span className="tabular-nums">{fmtNumber(row.emissions_g / 1000, 1)} kg</span>
          <Text as="p" variant="caption">
            {row.emissions_g_per_m != null
              ? t('ownership.compliance.row.emissionsRate', '{{value}} g per km', {
                  value: fmtNumber(row.emissions_g_per_m * 1000, 1),
                })
              : '—'}
          </Text>
        </div>
      ),
    },
    {
      key: 'confidence',
      header: t('ownership.compliance.row.confidence', 'Confidence'),
      render: (row) => (
        <span
          className={`tabular-nums ${row.confidence_pct >= 90 ? 'text-emerald-300' : row.confidence_pct >= 60 ? 'text-amber-300' : 'text-rose-300'}`}
        >
          {formatPct(row.confidence_pct, 0)}
        </span>
      ),
    },
  ];

  const rateColumns: Column<JurisdictionRate>[] = [
    {
      key: 'code',
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
      render: (row) => (
        <span className="tabular-nums">
          {formatPricePerDistance(
            row.road_usage_minor_per_m,
            row.currency,
            units.unitPrefs,
          )}
        </span>
      ),
    },
    {
      key: 'registration',
      header: t('ownership.compliance.rate.registration', 'Annual registration'),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.registration_fee_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'grid',
      header: t('ownership.compliance.rate.grid', 'Grid intensity'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtNumber(row.grid_intensity_g_per_wh * 1000, 0)} g/kWh
        </span>
      ),
    },
    {
      key: 'bbox',
      header: t('ownership.compliance.rate.bbox', 'Bounding box'),
      render: (row) => (
        <Text as="span" variant="caption">
          {fmtNumber(row.min_lat, 3)},{fmtNumber(row.min_lng, 3)} → {fmtNumber(row.max_lat, 3)},
          {fmtNumber(row.max_lng, 3)}
        </Text>
      ),
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          onClick={() => deleteRate.mutate(row.id)}
        >
          {t('ownership.action.remove', 'Remove')}
        </Button>
      ),
    },
  ];

  const filingColumns: Column<ComplianceFiling>[] = [
    {
      key: 'period',
      header: t('ownership.compliance.filing.period', 'Period'),
      render: (row) => (
        <Text as="span" variant="caption">
          {formatDateTime(row.period_start)} → {formatDateTime(row.period_end)}
        </Text>
      ),
      sortable: true,
    },
    {
      key: 'distance',
      header: t('ownership.compliance.filing.distance', 'Distance'),
      render: (row) => <span className="tabular-nums">{units.formatDistance(row.total_distance_m)}</span>,
    },
    {
      key: 'energy',
      header: t('ownership.compliance.filing.energy', 'Energy'),
      render: (row) => <span className="tabular-nums">{units.formatEnergy(row.total_energy_wh)}</span>,
    },
    {
      key: 'charge',
      header: t('ownership.compliance.filing.charge', 'Charge'),
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
        <span className="font-mono text-xs text-cyan-300">{row.digest.slice(0, 16)}…</span>
      ),
    },
  ];

  return (
    <PageContainer
      title={t('ownership.compliance.title', 'Jurisdictional Compliance & Road-Usage Charge')}
      subtitle={t(
        'ownership.compliance.subtitle',
        'Apportion every metre you drove to the jurisdiction it happened in, price it against that jurisdiction’s road-usage rate, and seal the period into an immutable filing record.',
      )}
      loading={reportQuery.isLoading}
      error={reportQuery.error as Error | null}
      actions={
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
          <VehicleSelect withIcon />
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
        <OwnershipPanel title={t('ownership.compliance.summary.title', 'Period liability')}>
          <StatGrid
            stats={[
              {
                key: 'distance',
                label: t('ownership.compliance.stat.distance', 'Total distance'),
                value: units.formatDistance(report?.total_distance_m ?? 0),
                hint: t('ownership.compliance.stat.drives', '{{count}} drives', {
                  count: report?.drive_count ?? 0,
                }),
              },
              {
                key: 'assigned',
                label: t('ownership.compliance.stat.assigned', 'Assigned to a jurisdiction'),
                value: units.formatDistance(report?.assigned_distance_m ?? 0),
                tone: 'positive',
              },
              {
                key: 'unassigned',
                label: t('ownership.compliance.stat.unassigned', 'Unassigned'),
                value: units.formatDistance(report?.unassigned_distance_m ?? 0),
                hint: formatPct(report?.unassigned_share_pct ?? 0),
                tone: (report?.unassigned_share_pct ?? 0) > 10 ? 'warning' : 'default',
              },
              {
                key: 'roadUsage',
                label: t('ownership.compliance.stat.roadUsage', 'Road-usage charge'),
                value: formatCurrencyMinor(
                  report?.total_road_usage_charge_minor,
                  currency,
                  units.unitPrefs.locale,
                ),
              },
              {
                key: 'liability',
                label: t('ownership.compliance.stat.liability', 'Total liability'),
                value: formatCurrencyMinor(
                  report?.total_liability_minor,
                  currency,
                  units.unitPrefs.locale,
                ),
                tone: 'warning',
              },
              {
                key: 'emissions',
                label: t('ownership.compliance.stat.emissions', 'Attributed emissions'),
                value: `${fmtNumber((report?.total_emissions_g ?? 0) / 1000, 1)} kg`,
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.compliance.apportion.title', 'Apportionment by jurisdiction')}
          description={t(
            'ownership.compliance.apportion.subtitle',
            'Confidence is 95% when both endpoints fall in the same box, 70% when only one does, and 60% for a cross-border split.',
          )}
          empty={jurisdictions.length === 0}
          emptyMessage={t(
            'ownership.compliance.apportion.empty',
            'No drives with usable coordinates in this window.',
          )}
        >
          <DataTable
            columns={apportionColumns}
            data={jurisdictions}
            keyExtractor={(row) => row.jurisdiction_code}
            tableId="ownership-compliance-apportion"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.compliance.rates.title', 'Jurisdiction rate table')}
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
              icon={<Landmark className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setRateOpen((open) => !open)}
            >
              {rateOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.compliance.rates.add', 'Add jurisdiction')}
            </Button>
          }
        >
          {rateOpen ? (
            <form className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={submitRate}>
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
                  value: fmtNumber(rateDraft.grid_intensity_g_per_wh * 1000, 0),
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
                required
                onChange={(event) =>
                  setRateDraft((current) => ({ ...current, max_lng: Number(event.target.value) }))
                }
              />
              <div className="md:col-span-2 xl:col-span-4">
                <Button type="submit" loading={createRate.isPending}>
                  {t('ownership.compliance.rateForm.save', 'Save jurisdiction')}
                </Button>
                <MutationError error={createRate.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={rateColumns}
            data={rates}
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
          description={t(
            'ownership.compliance.filings.subtitle',
            'Sealing a period snapshots the distance, energy and charge behind a digest, so a later dispute can be settled against the exact figures you filed.',
          )}
          empty={filings.length === 0 && !filingOpen}
          emptyMessage={t('ownership.compliance.filings.empty', 'No periods sealed yet.')}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Stamp className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setFilingOpen((open) => !open)}
            >
              {filingOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.compliance.filings.add', 'Seal a period')}
            </Button>
          }
        >
          {filingOpen ? (
            <form className="mb-6 grid gap-4 md:grid-cols-3" onSubmit={submitFiling}>
              <Input
                type="date"
                label={t('ownership.compliance.filingForm.start', 'Period start')}
                value={toDateInput(filingDraft.period_start)}
                required
                onChange={(event) =>
                  setFilingDraft((current) => ({
                    ...current,
                    period_start: fromDateInput(event.target.value),
                  }))
                }
              />
              <Input
                type="date"
                label={t('ownership.compliance.filingForm.end', 'Period end')}
                value={toDateInput(filingDraft.period_end)}
                required
                onChange={(event) =>
                  setFilingDraft((current) => ({
                    ...current,
                    period_end: fromDateInput(event.target.value),
                  }))
                }
              />
              <div className="flex items-end">
                <Button type="submit" loading={createFiling.isPending} disabled={vehicleId == null}>
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
            data={filings}
            keyExtractor={(row) => row.id}
            tableId="ownership-compliance-filings"
            emptyMessage={t('ownership.compliance.filings.empty', 'No periods sealed yet.')}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel title={t('ownership.compliance.digest.title', 'Period digest')}>
          <Text as="p" variant="caption">
            {t(
              'ownership.compliance.digest.body',
              'A stable fingerprint of the apportionment above. If the underlying drives change, the digest changes — which is exactly what makes a sealed filing meaningful.',
            )}
          </Text>
          <p className="mt-2 break-all font-mono text-sm text-cyan-300">{report?.digest || '—'}</p>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <EvidencePanel
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
    </PageContainer>
  );
}
