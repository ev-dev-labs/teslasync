import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useTripPacket, useTripPacketChange } from '@/api/hooks/useTripPacket';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, Input, Select, Text, Toggle } from '@/components/ui';
import { PrivateVehicleReviewPanel, type PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { usePrivateReviewExpiry } from '@/hooks/usePrivateReviewExpiry';
import { downloadJSON } from '@/lib/csvExport';
import type { Drive } from '@/types/driving';
import type { TripPacket, TripPacketEntry, TripPacketVersion } from '@/types/tripPacket';
import { TripPacketEntryForm } from './TripPacketEntryForm';
import { TripPacketEvidence } from './TripPacketEvidence';

type Dialog = { kind: 'export'; version: TripPacketVersion; digest: string } | { kind: 'clear'; version: TripPacketVersion };

function sameVersion(a: TripPacketVersion | null | undefined, b: TripPacketVersion | null | undefined) {
  return a != null && b != null && a.id === b.id && a.revision === b.revision;
}

function privacyDenied(error: unknown) {
  return isApiError(error) && (error.code === 'IDENTITY_CHANGED' || [401, 403, 404].includes(error.status));
}

function downloadPacket(packet: TripPacket) {
  const { from, through, business_drives, matched_receipts, unclassified_drive_count,
    business_drives_without_distance, unmatched_receipts, observed_business_distance_m } = packet;
  downloadJSON('private-trip-packet', {
    from, through, business_drives_without_distance, unmatched_receipts, observed_business_distance_m,
    unclassified_drive_count,
    business_drives: (business_drives ?? []).map(({ drive_id, started_at, ended_at, distance_m }) => ({ drive_id, started_at, ended_at, distance_m })),
    matched_receipts: (matched_receipts ?? []).map(({ drive_id, receipt_day, reference, currency, amount_minor }) =>
      ({ drive_id, receipt_day, reference, currency, amount_minor })),
  });
}

export function TripPacketPanel({ vehicleId, drives }: { vehicleId: number; drives: readonly Drive[] }) {
  const { t } = useTranslation();
  return <PrivateVehicleReviewPanel vehicleId={vehicleId} anchor="private-trip-packet"
    title={t('logbook.packet.title', 'Private monthly trip packet')}
    description={t('logbook.packet.description', 'Off by default. Review confirmed business drives and matched receipt references before downloading. Browser-local categories and route suggestions do not count as consent.')}
    openLabel={t('logbook.packet.open', 'Open private trip packet')}
    vehiclePrompt={t('logbook.packet.vehicle', 'Select a vehicle to prepare a private packet.')}
    signInPrompt={t('logbook.packet.signIn', 'Sign in to prepare a private packet.')}>
    {props => <Details key={`${props.scope.subject}:${props.vehicleId}`} {...props} drives={drives} />}
  </PrivateVehicleReviewPanel>;
}

function Details({ scope, vehicleId, identityPending, drives }: PrivateVehicleReviewScope & { drives: readonly Drive[] }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { tz } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useTripPacket(scope, vehicleId);
  const source = useDataState(query);
  const change = useTripPacketChange(scope, vehicleId);
  const [setup, setSetup] = useState<{ version: TripPacketVersion; zone: string; confirmed: boolean }>();
  const [drive, setDrive] = useState<number>();
  const [dialog, setDialog] = useState<Dialog>();
  const setupButton = useRef<HTMLButtonElement>(null);
  const zoneField = useRef<HTMLInputElement>(null);
  const restore = useRef(false);
  const review = source.data;
  const plan = review?.plan;
  const current = usePrivateReviewExpiry(review?.expires_at, query.refetch);
  const packet = current ? review?.packet : null;
  const blocked = !canWrite || identityPending || source.status !== 'ok' || query.isFetching || change.isPending;
  const setupOpen = setup != null;
  useEffect(() => {
    if (setupOpen) zoneField.current?.focus();
  }, [setupOpen]);
  useEffect(() => {
    if (restore.current && !blocked && !setup) {
      setupButton.current?.focus();
      restore.current = false;
    }
  }, [blocked, setup]);
  const unavailable = source.fatalError ?? (privacyDenied(source.refreshError) ? source.refreshError : null);
  if (unavailable) return <QueryError error={unavailable} onRetry={() => void query.refetch()} />;
  if (!review) return source.isRefreshBlocked
    ? <Text as="p" variant="bodySm">{t('logbook.packet.offline', 'Reconnect to view or change the private trip packet.')}</Text>
    : <Skeleton lines={2} />;

  const version = plan ?? { id: 0, revision: 0 };
  const finish = () => {
    restore.current = true;
    setSetup(undefined);
  };
  const exportLabel = t('logbook.packet.export', 'Download reviewed trip packet');
  const clearLabel = t('logbook.packet.clear', 'Turn off and clear private packet');
  const lockDialog = blocked || !sameVersion(plan, dialog?.version) ||
    (dialog?.kind === 'export' && (!packet || dialog.digest !== review.digest));
  const options = new Map<number, string>();
  for (const id of packet?.unclassified_drive_ids ?? []) options.set(id, t('logbook.packet.unclassifiedDrive', 'Unclassified drive {{id}}', { id }));
  for (const row of drives) {
    if (row.vehicleId === vehicleId && row.endTs && !options.has(row.id)) {
      options.set(row.id, t('logbook.packet.driveOption', 'Drive {{id}} on {{date}}', {
        id: row.id, date: formatDateTime(row.startTs),
      }));
    }
  }
  if (drive != null && !options.has(drive)) {
    options.set(drive, t('logbook.packet.driveNumber', 'Drive {{id}}', { id: drive }));
  }
  return <div className="space-y-3">
    <StaleRefreshWarning state={source} />
    <Text as="p" role="status" variant="bodySm">{!plan
      ? t('logbook.packet.off', 'Off. No private packet is scheduled.')
      : plan.paused ? t('logbook.packet.paused', 'Paused. Confirmed tags and receipt references are kept, but no packet is prepared.')
        : packet ? t('logbook.packet.active', 'Active. A private packet is ready.')
          : t('logbook.packet.waiting', 'Active. Waiting for the monthly check or sufficient confirmed evidence.')}</Text>
    {plan?.next_check_at && <Text variant="caption">{t('logbook.packet.next', 'Next check: {{date}}.', {
      date: formatDateTime(plan.next_check_at),
    })}</Text>}
    {change.error && <QueryError error={change.error} />}
    {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
    <div className="flex flex-wrap gap-2">
      <Button ref={setupButton} type="button" className="min-h-11" variant="secondary" wrapLabel
        aria-expanded={setup != null} disabled={blocked}
        onClick={() => setup ? finish() : setSetup({ version, zone: plan?.time_zone ?? tz, confirmed: false })}>
        {setup ? t('logbook.packet.cancelSetup', 'Cancel packet settings')
          : !plan ? t('logbook.packet.setup', 'Set up monthly trip packets')
            : plan.paused ? t('logbook.packet.resume', 'Resume private packets')
              : t('logbook.packet.edit', 'Edit packet settings')}
      </Button>
      {plan && !setup && <>
        {!plan.paused && <Button type="button" className="min-h-11" variant="ghost" disabled={blocked}
          onClick={() => change.mutate({ kind: 'save', version: plan, zone: plan.time_zone, paused: true }, { onSuccess: finish })}>
          {t('logbook.packet.pause', 'Pause private packets')}
        </Button>}
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked}
          onClick={() => setDialog({ kind: 'clear', version: plan })}>{clearLabel}</Button>
      </>}
    </div>
    {setup && <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (!blocked && sameVersion(version, setup.version) && setup.confirmed && setup.zone.trim()) {
        change.mutate({ kind: 'save', version, zone: setup.zone.trim(), paused: false }, { onSuccess: finish });
      }
    }}>
      <Input ref={zoneField} label={t('logbook.packet.zone', 'Packet time zone')} value={setup.zone} required disabled={blocked}
        hint={t('logbook.packet.zoneHint', 'Use the IANA time zone for this logbook, such as America/New_York.')}
        maxLength={80} onChange={event => setSetup({ ...setup, zone: event.target.value, confirmed: false })} />
      <Toggle label={t('logbook.packet.consent', 'Use this vehicle’s completed drives and the purposes and receipts I explicitly enter to prepare private monthly packets.')}
        checked={setup.confirmed} disabled={blocked || !setup.zone.trim()}
        onChange={confirmed => setSetup({ ...setup, confirmed })} />
      <Button className="min-h-11" type="submit" wrapLabel disabled={blocked || !sameVersion(version, setup.version) || !setup.confirmed || !setup.zone.trim()}>
        {t('logbook.packet.confirm', 'Confirm private packet setup')}
      </Button>
    </form>}
    {plan && !plan.paused && !setup && <div className="space-y-3">
      <Select label={t('logbook.packet.selectDrive', 'Select a drive to confirm its purpose')} value={drive ?? ''} disabled={blocked}
        options={[{ value: '', label: t('logbook.packet.chooseDrive', 'Choose a completed drive') },
          ...Array.from(options, ([value, label]) => ({ value: String(value), label }))]}
        onChange={event => setDrive(Number(event.target.value) || undefined)} />
      {options.size === 0 && <Text as="p" variant="caption">
        {t('logbook.packet.noDrives', 'No completed drives are in this view. Change the range in View settings to find a drive.')}
      </Text>}
      {drive != null && <EntryDetails key={drive} scope={scope} vehicleId={vehicleId} drive={drive} version={plan}
        disabled={blocked} onSave={entry => change.mutate({ kind: 'entry', version: plan, entry })} />}
    </div>}
    {plan && packet && <TripPacketEvidence packet={packet} zone={plan.time_zone} vehicleId={vehicleId} />}
    {plan && packet && review.digest && <div className="flex flex-wrap gap-2">
      <Button type="button" className="min-h-11" wrapLabel disabled={blocked}
        onClick={() => setDialog({ kind: 'export', version: plan, digest: review.digest ?? '' })}>{exportLabel}</Button>
      <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={blocked}
        onClick={() => change.mutate({ kind: 'dismiss', version: plan, through: packet.through }, { onSuccess: finish })}>
        {t('logbook.packet.dismiss', 'Dismiss this month’s packet')}
      </Button>
    </div>}
    {dialog && <ConfirmDialog open variant={dialog.kind === 'clear' ? 'danger' : 'warning'}
      title={dialog.kind === 'clear' ? clearLabel : exportLabel} confirmLabel={dialog.kind === 'clear' ? clearLabel : exportLabel}
      message={dialog.kind === 'clear'
        ? t('logbook.packet.clearDetail', 'Stop checks and remove private tags and receipt references? Your original drives and browser-local logbook will be kept.')
        : t('logbook.packet.exportDetail', 'Download the reviewed JSON packet to this device? It contains your confirmed business drives and receipt references. Nothing is sent to another recipient.')}
      details={change.error && <QueryError error={change.error} />}
      loading={change.isPending} confirmDisabled={lockDialog} onCancel={() => setDialog(undefined)}
      onConfirm={() => {
        if (lockDialog) return;
        change.mutate(dialog, { onSuccess: result => {
          if (result) downloadPacket(result);
          if (dialog.kind === 'clear') { setDrive(undefined); finish(); }
          setDialog(undefined);
        } });
      }} />}
  </div>;
}

function EntryDetails({ scope, vehicleId, drive, version, disabled, onSave }: {
  scope: PrivateVehicleReviewScope['scope'];
  vehicleId: number;
  drive: number;
  version: TripPacketVersion;
  disabled: boolean;
  onSave: (entry: TripPacketEntry) => void;
}) {
  const { t } = useTranslation();
  const query = useTripPacket(scope, vehicleId, drive);
  const source = useDataState(query);
  const error = source.fatalError ?? (privacyDenied(source.refreshError) ? source.refreshError : null);
  if (error) return <QueryError error={error} onRetry={() => void query.refetch()} />;
  if (!source.data) return source.isRefreshBlocked
    ? <Text as="p" variant="caption">{t('logbook.packet.offline', 'Reconnect to view or change the private trip packet.')}</Text>
    : <Skeleton lines={2} />;
  if (!source.data.entry) return <Text as="p" variant="caption">
    {t('logbook.packet.entryUnavailable', 'This drive is not available for a private classification.')}
  </Text>;
  return <>
    <StaleRefreshWarning state={source} />
    <TripPacketEntryForm key={`${drive}:${source.data.plan?.id}:${source.data.plan?.revision}`} entry={source.data.entry}
      disabled={disabled || query.isFetching || source.status !== 'ok' || !sameVersion(source.data.plan, version)} onSave={onSave} />
  </>;
}
