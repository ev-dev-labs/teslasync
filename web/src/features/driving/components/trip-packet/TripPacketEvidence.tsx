import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { KVList } from '@/components/data-display';
import { DataTable, PanelTitle, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { currencyFractionDigits, formatCurrencyValue } from '@/lib/currencyFormat';
import type { TripPacket } from '@/types/tripPacket';

interface Props {
  packet: TripPacket;
  zone: string;
  vehicleId: number;
}

export function TripPacketEvidence({ packet, zone, vehicleId }: Props) {
  const { t } = useTranslation();
  const { formatDateTime, formatDayKey } = useDateFormat('user');
  const { formatDistance, unitPrefs: { locale = 'en-US' } } = useUnits();
  const drives = packet.business_drives ?? [];
  const receipts = packet.matched_receipts ?? [];
  const driveLink = (id: number) => <Link className="inline-flex min-h-11 items-center underline"
    to={`/drives/${id}?vehicle_id=${vehicleId}`}>{t('logbook.packet.driveNumber', 'Drive {{id}}', { id })}</Link>;
  return <div className="space-y-3">
    <PanelTitle>{t('logbook.packet.ready', 'Business trip packet ready to review')}</PanelTitle>
    <Text as="p" variant="caption">{t('logbook.packet.window', 'Drives started from {{from}} up to {{through}} ({{zone}}).', {
      from: formatDateTime(packet.from, { tz: zone }), through: formatDateTime(packet.through, { tz: zone }), zone,
    })}</Text>
    <KVList items={[
      { label: t('logbook.packet.confirmedDrives', 'Confirmed business drives'), value: drives.length },
      { label: t('logbook.packet.knownDistance', 'Recorded business distance'), value: drives.length > packet.business_drives_without_distance
        ? formatDistance(packet.observed_business_distance_m) : '—' },
      { label: t('logbook.packet.missingDistance', 'Business drives without distance'), value: packet.business_drives_without_distance },
      { label: t('logbook.unclassified', 'Unclassified'), value: packet.unclassified_drive_count },
      { label: t('logbook.packet.unmatchedReceipts', 'Receipt references excluded'), value: packet.unmatched_receipts },
    ]} />
    <Text as="p" variant="caption">{t('logbook.packet.why', 'Why this? Each included drive was explicitly marked Business for this packet. Unclassified drives and unmatched receipts are not included in the exported business totals. No tax or reimbursement eligibility is inferred.')}</Text>
    <PanelTitle>{t('logbook.packet.confirmedDrives', 'Confirmed business drives')}</PanelTitle>
    <DataTable tableId="driving:trip-packet-drives" variant="embedded" pagination data={drives}
      keyExtractor={row => row.drive_id} mobileColumns={['drive_id', 'started_at', 'distance_m']}
      columns={[
        { key: 'drive_id', header: t('logbook.packet.drive', 'Drive'), render: row => driveLink(row.drive_id) },
        { key: 'started_at', header: t('logbook.date', 'Date'), render: row => formatDateTime(row.started_at, { tz: zone }) },
        { key: 'distance_m', header: t('logbook.distance', 'Distance'), render: row => row.distance_m == null ? '—' : formatDistance(row.distance_m) },
      ]} />
    <PanelTitle>{t('logbook.packet.matchedReceipts', 'Matched receipts')}</PanelTitle>
    <DataTable tableId="driving:trip-packet-receipts" variant="embedded" pagination data={receipts}
      keyExtractor={row => `${row.drive_id}:${row.receipt_day}:${row.currency}:${row.reference}`}
      mobileColumns={['reference', 'amount_minor', 'drive_id', 'receipt_day']}
      emptyMessage={t('logbook.packet.noReceipts', 'No receipt references were matched. This packet can still include confirmed business distance.')}
      columns={[
        { key: 'reference', header: t('logbook.packet.receiptReference', 'Receipt reference'), render: row => <Text className="break-all" variant="bodySm">{row.reference}</Text> },
        { key: 'amount_minor', header: t('logbook.amount', 'Amount'), render: row => {
          const digits = currencyFractionDigits(row.currency, locale);
          return <Text variant="bodySm">{formatCurrencyValue(row.amount_minor / 10 ** digits, row.currency, locale, digits)} {row.currency}</Text>;
        } },
        { key: 'drive_id', header: t('logbook.packet.drive', 'Drive'), render: row => driveLink(row.drive_id) },
        { key: 'receipt_day', header: t('logbook.date', 'Date'), render: row => formatDayKey(row.receipt_day) },
      ]} />
  </div>;
}
