import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTeslaExclusive } from '@/api/hooks/useTeslaPhysics';
import { DataProvenanceBadge } from '@/components/data-display';
import { EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { PageContainer } from '@/components/layout';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { ExclusiveReport } from '@/types/teslaPhysics';

export type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;
export const pagination = { defaultPageSize: 25, pageSizeOptions: [25, 50, 100] };
export const unknown = (t: Translate) => t('teslaOnly.unknown', 'unknown');
export const time = (value: string | null | undefined, t: Translate) => value ? formatDateTime(value) : unknown(t);
export const seconds = (value: number | null | undefined, t: Translate) => value == null ? unknown(t) : `${fmtNumber(value, 0)} s`;
export const hours = (value: number | null | undefined, t: Translate) => value == null ? unknown(t) : `${fmtNumber(value, 1)} h`;
export const yesNo = (value: boolean | null | undefined, t: Translate) =>
  value == null ? unknown(t) : value ? t('teslaOnly.yes', 'Yes') : t('teslaOnly.no', 'No');

export const features = [
  { slug: 'clocks', title: 'Three Clocks', slice: 'clocks' },
  { slug: 'life-tape', title: 'Life Tape', slice: 'life_tape' },
  { slug: 'contradictions', title: 'Contradiction Court', slice: 'contradictions' },
  { slug: 'meters', title: 'Trip-Meter Genealogy', slice: 'meters' },
  { slug: 'unknown', title: 'Unknown OS', slice: 'unknown_os' },
  { slug: 'car-kept-living', title: 'Car Kept Living', slice: 'car_kept_living' },
  { slug: 'logbook', title: 'Tesla-Language Logbook', slice: 'logbook' },
  { slug: 'firmware-epochs', title: 'Firmware Epochs', slice: 'firmware_epochs' },
  { slug: 'charge-port', title: 'Charge-Port Court', slice: 'charge_port_court' },
  { slug: 'black-box', title: 'Black Box 90s', slice: 'black_box' },
  { slug: 'dictionary', title: 'Owner Dictionary', slice: 'dictionary' },
  { slug: 'vault', title: 'Physics Vault', slice: 'vault' },
  { slug: 'modes', title: 'Mode Laws', slice: 'modes' },
  { slug: 'nervous-system', title: 'Nervous System', slice: 'nervous_system' },
  { slug: 'range', title: 'Range Disagreement', slice: 'range' },
] as const satisfies ReadonlyArray<{ slug: string; title: string; slice: keyof ExclusiveReport }>;
export type PhysicsSlug = typeof features[number]['slug'];

export function usePhysicsPage(slug?: PhysicsSlug) {
  const { t: translate } = useTranslation();
  const t: Translate = (key, fallback, options) => String(translate(key, fallback, options));
  const { vehicleId } = useSelectedVehicle();
  const query = useTeslaExclusive(vehicleId == null ? undefined : String(vehicleId));
  const state = useDataState(query, { provenance: 'historical' });
  const feature = features.find((item) => item.slug === slug);
  const title = feature ? t(`teslaOnly.${feature.slug === 'life-tape' ? 'lifeTape' : feature.slug === 'firmware-epochs' ? 'epochs' : feature.slug === 'charge-port' ? 'portCourt' : feature.slug === 'black-box' ? 'blackBox' : feature.slug === 'car-kept-living' ? 'carKeptLiving' : feature.slug === 'nervous-system' ? 'nervous' : feature.slug === 'unknown' ? 'unknownOS' : feature.slug}`, feature.title) : t('teslaOnly.title', 'Tesla Physics');
  return { slug, t, title, vehicleId, query, state, report: state.data };
}

export type PhysicsPage = ReturnType<typeof usePhysicsPage>;

export function PhysicsPageShell({ physics, children, navigation }: {
  physics: PhysicsPage; children: ReactNode; navigation: ReactNode;
}) {
  const { slug, t, title, vehicleId, query, state, report } = physics;
  const pageTitle = t('teslaOnly.title', 'Tesla Physics');
  usePageTitle(pageTitle);
  if (vehicleId == null) return <NoVehicleSelected pageTitle={pageTitle} />;
  const slice = features.find((feature) => feature.slug === slug)?.slice;
  const evidence = report?.evidence;
  const limited = evidence && (!evidence.history_available || !evidence.black_box_available || evidence.history_truncated ||
    evidence.black_box_truncated || evidence.drive_sessions_truncated || evidence.charge_sessions_truncated);
  return <PageContainer title={pageTitle} subtitle={t('teslaOnly.workbench.subtitle', 'A bounded evidence workbench: conclusions first, raw observations on demand.')}
    query={query} copyLink contextActions={<div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      <DataProvenanceBadge provenance={state.provenance} status={state.status} updatedAt={state.updatedAt} />
    </div>}>
    <StaleRefreshWarning state={state} label={title} />
    {navigation}
    {state.fatalError ? <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} /> : report ? <div className="space-y-6">
      <GlassPanel className="space-y-3 p-4 sm:p-5">
        <PanelTitle>{t('teslaOnly.scopeTitle', 'Evidence boundaries')}</PanelTitle>
        {limited && <Badge variant="warning" size="sm">{t('teslaOnly.partialEvidence', 'Partial or unavailable evidence — do not interpret counts as complete')}</Badge>}
        {evidence ? <>
          <Text as="p" variant="bodySm">{t('teslaOnly.scopeRequested', 'Requested: {{from}} → {{to}}', { from: time(evidence.requested_from, t), to: time(evidence.requested_to, t) })}</Text>
          <Text as="p" variant="bodySm">{t('teslaOnly.scopeObserved', 'Recorded: {{from}} → {{to}}', { from: time(evidence.first_recorded_at, t), to: time(evidence.last_recorded_at, t) })}</Text>
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral" size="sm">{t('teslaOnly.historyRows', 'History rows: {{count}}', { count: evidence.history_rows })}</Badge>
            <Badge variant="neutral" size="sm">{t('teslaOnly.blackBoxRows', 'Black-box rows: {{count}}', { count: evidence.black_box_rows })}</Badge>
            {!evidence.history_available && <Badge variant="warning" size="sm">{t('teslaOnly.historyUnavailable', 'History unavailable')}</Badge>}
            {!evidence.black_box_available && <Badge variant="warning" size="sm">{t('teslaOnly.blackBoxUnavailable', 'Black-box evidence unavailable')}</Badge>}
            {evidence.history_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.historyCapped', 'History row cap reached')}</Badge>}
            {evidence.black_box_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.blackBoxCapped', 'Black-box row cap reached')}</Badge>}
            {evidence.drive_sessions_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.drivesCapped', 'Drive session cap reached')}</Badge>}
            {evidence.charge_sessions_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.chargesCapped', 'Charge session cap reached')}</Badge>}
          </div>
        </> : <Text as="p" variant="bodySm">{t('teslaOnly.scopeUnavailable', 'Evidence coverage metadata was not returned; counts cannot establish completeness.')}</Text>}
        <Text as="p" variant="caption">{t('teslaOnly.scopeCaution', 'The exclusive report covers at most 14 days. Row caps, missing history, and partial session coverage limit conclusions; a zero finding is not lifetime proof.')}</Text>
      </GlassPanel>
      {slice && !report[slice] ? <GlassPanel className="p-4 sm:p-5">
        {/* no-action: missing evidence cannot be restored from a display-only page. */}
        <EmptyState title={title} message={t('teslaOnly.missingSlice', 'This evidence slice was not returned. No measurement is inferred from its absence.')} />
      </GlassPanel> : children}
    </div> : <>
      {/* no-action: VehicleSelect is already in the header. */}
      <EmptyState title={title} message={t('teslaOnly.empty', 'Select a vehicle to load Tesla physics.')} />
    </>}
  </PageContainer>;
}
