import { useMemo, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChargingForensics, fetchAllChargingForensics } from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, DataTable, Pagination, type Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import type { ChargingForensicsItem } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel } from '../components';
import { formatCurrencyMinor } from '../formatters';

const PAGE_SIZE = 15;

export default function ChargingForensicsPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [page, setPage] = useState(1);
  const query = useChargingForensics(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const items = query.data?.items ?? [];
  usePageTitle(t('advancedIntelligence.forensics.title', 'Charging Forensics'));

  const money = (minor: number | null, currency: string | null) => {
    if (minor == null || !currency) return '—';
    return formatCurrencyMinor(minor, currency, units.unitPrefs.locale);
  };

  const columns = useMemo<Column<ChargingForensicsItem>[]>(() => [
    {
      key: 'session',
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
      header: t('advancedIntelligence.forensics.vehicleEnergy', 'Vehicle energy'),
      render: (row) => units.formatEnergy(row.vehicle_energy_wh),
    },
    {
      key: 'meter_energy',
      header: t('advancedIntelligence.forensics.meterEnergy', 'Meter energy'),
      render: (row) => row.meter_energy_wh != null
        ? units.formatEnergy(row.meter_energy_wh)
        : t('advancedIntelligence.unsupported.short', 'Unsupported'),
    },
    {
      key: 'loss',
      header: t('advancedIntelligence.forensics.loss', 'Estimated loss'),
      render: (row) => row.estimated_loss_wh != null
        ? `${units.formatEnergy(row.estimated_loss_wh)} (${units.formatEnergy(row.estimated_loss_low_wh)}–${units.formatEnergy(row.estimated_loss_high_wh)})`
        : t('advancedIntelligence.unsupported.short', 'Unsupported'),
    },
    {
      key: 'recorded_cost',
      header: t('advancedIntelligence.forensics.recordedCost', 'Recorded cost'),
      render: (row) => row.recorded_cost_minor != null && row.currency
        ? money(row.recorded_cost_minor, row.currency)
        : t('advancedIntelligence.unsupported.short', 'Unsupported'),
    },
    {
      key: 'expected_cost',
      header: t('advancedIntelligence.forensics.expectedCost', 'Expected cost'),
      render: (row) => row.expected_cost_minor != null && row.currency
        ? money(row.expected_cost_minor, row.currency)
        : t('advancedIntelligence.unsupported.short', 'Unsupported'),
    },
    {
      key: 'discrepancy',
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
  ], [t, units]);

  return (
    <PageContainer
      title={t('advancedIntelligence.forensics.title', 'Charging Forensics')}
      subtitle={t(
        'advancedIntelligence.forensics.subtitle',
        'Reconcile vehicle, meter, energy-loss, and cost records without filling unsupported fields.',
      )}
      actions={<VehicleSelect withIcon />}
      loading={vehicleId != null && query.isLoading}
      error={query.error instanceof Error ? query.error : null}
    >
      <AlertBanner
        variant="info"
        icon={<ReceiptText className="h-5 w-5" aria-hidden="true" />}
        title={t('advancedIntelligence.forensics.notice.title', 'Null means unsupported, not zero')}
      >
        {t(
          'advancedIntelligence.forensics.notice.body',
          'Meter, tariff, loss, and cost values are displayed only when the backend can support them.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.forensics.reconciliation.title', 'Session reconciliation')}
          empty={items.length === 0}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t('advancedIntelligence.forensics.empty', 'No charging sessions are available for reconciliation.')}
        >
          <DataTable
            tableId="advanced-intelligence:charging-forensics"
            columns={columns}
            data={items}
            keyExtractor={(row) => row.session_id}
            mobileColumns={['session', 'started', 'status']}
            exportable
            exportFilename="charging-forensics"
            exportAll={() =>
              vehicleId == null ? Promise.resolve([]) : fetchAllChargingForensics(vehicleId)
            }
            exportRow={(row) => ({
              session_id: row.session_id,
              started_at: row.started_at,
              vehicle_energy_wh: row.vehicle_energy_wh,
              meter_energy_wh: row.meter_energy_wh ?? '',
              estimated_loss_wh: row.estimated_loss_wh ?? '',
              estimated_loss_low_wh: row.estimated_loss_low_wh ?? '',
              estimated_loss_high_wh: row.estimated_loss_high_wh ?? '',
              recorded_cost_minor: row.recorded_cost_minor ?? '',
              expected_cost_minor: row.expected_cost_minor ?? '',
              cost_discrepancy_minor: row.cost_discrepancy_minor ?? '',
              currency: row.currency ?? '',
              status: row.status,
            })}
            emptyMessage={t('advancedIntelligence.forensics.empty', 'No charging sessions are available for reconciliation.')}
          />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={query.data?.total ?? 0}
            onPageChange={setPage}
          />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <EvidencePanel
          quality={query.data?.data_quality}
          evidence={items.flatMap((item) => item.evidence ?? [])}
          limitations={items.flatMap((item) => item.limitations ?? [])}
          unsupported={[
            t('advancedIntelligence.forensics.unsupported.meter', 'Meter energy when no meter source is recorded'),
            t('advancedIntelligence.forensics.unsupported.cost', 'Expected cost without supported tariff and currency data'),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
