import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChargingForensics, fetchAllChargingForensics } from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, DataTable, Icon, Pagination, Text, type Column, type MobileDataTablePresentation } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { downloadCSV, downloadJSON, objectsToCSV } from '@/lib/csvExport';
import type { ChargingForensicsItem } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel } from '../components';
import { formatCurrencyMinor } from '../formatters';
import { chargingForensicsExportRow } from '../chargingForensicsExport';

const PAGE_SIZE = 15;

export default function ChargingForensicsPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const { formatDateTime } = useDateFormat();
  const { fmtInt } = useNumberFormatting();
  const [pagination, setPagination] = useState({ vehicleId, page: 1 });
  const page = pagination.vehicleId === vehicleId ? pagination.page : 1;
  if (pagination.vehicleId !== vehicleId) setPagination({ vehicleId, page: 1 });
  const query = useChargingForensics(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const items = query.data?.items ?? [];
  const total = query.data?.total;
  const hasTotal = typeof total === 'number' && Number.isSafeInteger(total) && total >= 0;
  useEffect(() => {
    if (!query.isSuccess || query.isPlaceholderData || !hasTotal ||
      query.data?.offset !== (page - 1) * PAGE_SIZE) return;
    const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > lastPage) setPagination({ vehicleId, page: lastPage });
  }, [query.isSuccess, query.isPlaceholderData, query.data?.offset, hasTotal, total, page, vehicleId]);
  usePageTitle(t('advancedIntelligence.forensics.title', 'Charging forensics'));

  const money = useCallback((minor: number | null, currency: string | null) => {
    if (minor == null || !currency) return '—';
    return formatCurrencyMinor(minor, currency, units.unitPrefs.locale);
  }, [units.unitPrefs.locale]);

  const exportReconciliation = async (format: 'csv' | 'json') => {
    if (vehicleId == null) return;
    const rows = (await fetchAllChargingForensics(vehicleId)).map(chargingForensicsExportRow);
    if (format === 'csv') downloadCSV('charging-forensics', objectsToCSV(rows));
    else downloadJSON('charging-forensics', rows);
  };

  const columns = useMemo<Column<ChargingForensicsItem>[]>(() => [
    {
      key: 'session',
      align: 'right',
      header: t('advancedIntelligence.forensics.session', 'Session'),
      visibleOnMobile: true,
      render: (row) => `#${row.session_id}`,
    },
    {
      key: 'started',
      header: t('advancedIntelligence.forensics.started', 'Started'),
      visibleOnMobile: true,
      render: (row) => formatDateTime(row.started_at),
    },
    {
      key: 'vehicle_energy',
      align: 'right',
      header: t('advancedIntelligence.forensics.vehicleEnergy', 'Vehicle energy'),
      render: (row) => units.formatEnergy(row.vehicle_energy_wh),
    },
    {
      key: 'meter_energy',
      align: 'right',
      header: t('advancedIntelligence.forensics.meterEnergy', 'Meter energy'),
      render: (row) => row.meter_energy_wh != null
        ? units.formatEnergy(row.meter_energy_wh)
        : t('advancedIntelligence.unsupported.short', 'Unsupported'),
    },
    {
      key: 'loss',
      align: 'right',
      header: t('advancedIntelligence.forensics.loss', 'Estimated loss'),
      render: (row) => row.estimated_loss_wh != null
        ? `${units.formatEnergy(row.estimated_loss_wh)} (${units.formatEnergy(row.estimated_loss_low_wh)}–${units.formatEnergy(row.estimated_loss_high_wh)})`
        : t('advancedIntelligence.unsupported.short', 'Unsupported'),
    },
    {
      key: 'recorded_cost',
      align: 'right',
      header: t('advancedIntelligence.forensics.recordedCost', 'Recorded cost'),
      render: (row) => row.recorded_cost_minor != null && row.currency
        ? money(row.recorded_cost_minor, row.currency)
        : t('advancedIntelligence.unsupported.short', 'Unsupported'),
    },
    {
      key: 'expected_cost',
      align: 'right',
      header: t('advancedIntelligence.forensics.expectedCost', 'Expected cost'),
      render: (row) => row.expected_cost_minor != null && row.currency
        ? money(row.expected_cost_minor, row.currency)
        : t('advancedIntelligence.unsupported.short', 'Unsupported'),
    },
    {
      key: 'discrepancy',
      align: 'right',
      header: t('advancedIntelligence.forensics.discrepancy', 'Cost discrepancy'),
      render: (row) => row.cost_discrepancy_minor != null && row.currency
        ? money(row.cost_discrepancy_minor, row.currency)
        : t('advancedIntelligence.unsupported.short', 'Unsupported'),
    },
    {
      key: 'status',
      header: t('advancedIntelligence.forensics.status', 'Status'),
      visibleOnMobile: true,
      render: (row) => <Badge variant={row.status === 'reconciled' ? 'success' : 'warning'}>{row.status}</Badge>,
    },
  ], [t, units, money, formatDateTime]);

  const mobilePresentation = useMemo<MobileDataTablePresentation<ChargingForensicsItem>>(() => ({
    roles: { session: 'title', vehicle_energy: 'primary', started: 'meta', status: 'badge' },
    displayValue: (row, key) => {
      if (key === 'status') return row.status;
      const value = columns.find((column) => column.key === key)?.render(row);
      return typeof value === 'string' || typeof value === 'number' ? value : null;
    },
    allDetails: (row) => [
      { key: 'ended_at', label: t('charging.detail.ended', 'Ended'), value: formatDateTime(row.ended_at) },
      { key: 'currency', label: t('charging.detail.currency', 'Currency'), value: row.currency },
      ...(row.evidence ?? []).map((evidence, index) => ({
        key: `evidence-${index}`,
        label: t('advancedIntelligence.evidence.sources', 'Evidence sources'),
        value: <div className="min-w-0 space-y-1 break-words">
          <Text as="p" variant="label">{evidence.source}</Text>
          <Text as="p" variant="bodySm">{evidence.summary}</Text>
          <Text as="p" variant="caption">{evidence.sample_count != null && Number.isFinite(evidence.sample_count)
            ? t('advancedIntelligence.evidence.sampleLine', '{{formattedCount}} samples · {{date}}', {
              count: evidence.sample_count,
              formattedCount: fmtInt(evidence.sample_count),
              date: formatDateTime(evidence.observed_at),
            })
            : formatDateTime(evidence.observed_at)}</Text>
        </div>,
      })),
      {
        key: 'limitations',
        label: t('advancedIntelligence.limitations.title', 'Limitations'),
        value: (row.limitations ?? []).length > 0
          ? <ul className="list-disc space-y-2 ps-4">{row.limitations.map((limitation, index) =>
            <Text as="li" variant="bodySm" key={index}>{limitation}</Text>)}</ul>
          : t('advancedIntelligence.limitations.empty', 'No additional limitations were returned.'),
      },
    ],
  }), [columns, formatDateTime, fmtInt, t]);

  return (
    <PageLayout
      title={t('advancedIntelligence.forensics.title', 'Charging forensics')}
      subtitle={t(
        'advancedIntelligence.forensics.subtitle',
        'Reconcile vehicle, meter, energy-loss, and cost records without filling unsupported fields.',
      )}
    >
      <AlertBanner
        variant="info"
        icon={<Icon icon={ReceiptText} size="lg" aria-hidden={true} />}
        title={t('advancedIntelligence.forensics.notice.title', 'Null means unsupported, not zero')}
      >
        {t(
          'advancedIntelligence.forensics.notice.body',
          'Meter, tariff, loss, and cost values are displayed only when the backend can support them.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          query={vehicleId != null ? query : undefined}
          title={t('advancedIntelligence.forensics.reconciliation.title', 'Session reconciliation')}
          empty={items.length === 0}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t('advancedIntelligence.forensics.empty', 'No charging sessions are available for reconciliation.')}
        >
          <DataTable
            tableId="advanced-intelligence:charging-forensics"
            caption={t('advancedIntelligence.forensics.reconciliation.title', 'Session reconciliation')}
            columns={columns}
            data={items}
            keyExtractor={(row) => row.session_id}
            mobileColumns={['session', 'started', 'status']}
            mobilePresentation={mobilePresentation}
            rowLabel={(row) => `${t('advancedIntelligence.forensics.session', 'Session')} #${row.session_id}`}
            exportable
            exportFilename="charging-forensics"
            controls={{
              exports: {
                onExportCsv: () => exportReconciliation('csv'),
                onExportJson: () => exportReconciliation('json'),
                disabled: vehicleId == null,
                description: t(
                  'advancedIntelligence.forensics.exportScope',
                  'Exports include the full reconciliation result with canonical SI values, uncertainty bounds, and currency, regardless of visible columns.',
                ),
              },
            }}
            emptyMessage={t('advancedIntelligence.forensics.empty', 'No charging sessions are available for reconciliation.')}
          />
        </InsightPanel>
        {vehicleId != null && (page > 1 || (hasTotal && total > PAGE_SIZE)) && (
          <div className="mt-4">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={Math.max(hasTotal ? total : 0, (page - 1) * PAGE_SIZE + 1)}
              onPageChange={(nextPage) => setPagination({ vehicleId, page: nextPage })}
            />
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.05}>
        <EvidencePanel
          query={query}
          quality={query.data?.data_quality}
          evidence={items.flatMap((item) => item.evidence ?? [])}
          limitations={items.flatMap((item) => item.limitations ?? [])}
          unsupported={[
            t('advancedIntelligence.forensics.unsupported.meter', 'Meter energy when no meter source is recorded'),
            t('advancedIntelligence.forensics.unsupported.cost', 'Expected cost without supported tariff and currency data'),
          ]}
        />
      </FadeIn>
    </PageLayout>
  );
}
