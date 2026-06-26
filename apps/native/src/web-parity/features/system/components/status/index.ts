/**
 * Native parity barrel for web/src/features/system/components/status/index.ts.
 *
 * The web module is a pure re-export barrel that forwards the System Status
 * page's twenty-two building blocks (seven accordion section bodies — Accordion,
 * HealthProbes, BackendStatus, ServiceHealth, Infrastructure, DataPipeline,
 * Operations — plus the AnomalyInlineRow and fifteen cards/callouts/forms:
 * BackgroundWorkers, BackupActions, TeslaAuth, TeslaApiUsage, TelemetryPipeline,
 * UpdateAvailableCallout, StatusPageSkeleton, LiveStatusPill, Incidents,
 * IncidentForm, ScheduledMaintenance, Subscribe, SLOTracking, FrontendErrors).
 * This barrel preserves that identical public export surface — all twenty-two
 * identifiers, in source order.
 *
 * BackgroundWorkersCard already has a dedicated native port in this directory,
 * so it is re-exported verbatim from './BackgroundWorkersCard'. The remaining
 * twenty-one web siblings are Tailwind/web-UI panels, DOM forms, Recharts charts
 * or lucide-react/router cards that have not yet been ported to their own native
 * files, so this barrel exposes native-safe placeholder components that render an
 * explicit "native port pending" state through the shared GlassPanel + AppText
 * primitives instead of importing any browser-only module (no DOM, Recharts,
 * Leaflet, react-router-dom, or web UI). StatusPageSkeleton — whose whole job is
 * a loading skeleton — renders skeleton bars to preserve that visual intent. Each
 * placeholder keeps the web prop names/shapes so future native call sites compile
 * unchanged; when a sibling gains a dedicated native port, replace its
 * placeholder below with a re-export of that file.
 *
 * Built with React.createElement because the output path must stay `index.ts`,
 * which cannot contain JSX (mirrors the sibling charging-curve/index.ts and
 * settings/components/index.ts native barrels).
 */

import React, {type ReactElement, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

export {BackgroundWorkersCard} from './BackgroundWorkersCard';

/**
 * Permissive structural stand-ins for the web prop types. The real domain types
 * (APIUsage, Vehicle, StatusLiveState, the api/hooks payloads) live in modules
 * that are either already ported or not-yet-ported; these accept the same prop
 * names so call sites compile unchanged, and the placeholder bodies ignore the
 * values until each section is fully ported. `ObjectLike` is `object` (not
 * `Record<string, unknown>`) so an interface-typed payload — which lacks an
 * implicit string index signature — stays assignable. No `any` is used.
 */
type ObjectLike = object;

/** Mirrors the web StatusLiveState union (live | reconnecting | offline). */
type StatusLiveState = 'live' | 'reconnecting' | 'offline';

interface AccordionSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

interface BackupActionsCardProps {
  children: ReactNode;
}

interface TeslaAuthCardProps {
  authenticated: boolean | undefined;
  expiresAt: string | undefined;
  now: number;
}

interface TeslaApiUsageCardProps {
  apiUsage: ObjectLike | undefined;
  now: number;
}

interface TelemetryPipelineCardProps {
  vehicles: ReadonlyArray<ObjectLike> | undefined;
  positionCount: number;
  drivesCount: number;
  chargingSessionsCount: number | undefined;
  signalLogCount: number | undefined;
  now: number;
}

interface UpdateAvailableCalloutProps {
  current: string | undefined;
  latest: string | undefined;
  checkedAt?: string;
}

interface LiveStatusPillProps {
  state: StatusLiveState;
  lastUpdateAt: number | null;
  now: number;
}

interface IncidentsCardProps {
  now: number;
}

interface IncidentFormProps {
  onClose: () => void;
}

interface ScheduledMaintenanceCardProps {
  now: number;
}

type PlaceholderComponent<P> = (props: P) => ReactElement;

const KICKER_LABEL = 'System status';
const UNAVAILABLE_HINT = 'Native port pending';

function renderPlaceholder(section: string): ReactElement {
  return React.createElement(GlassPanel, {
    style: styles.panel,
    children: [
      React.createElement(
        AppText,
        {key: 'kicker', variant: 'caption', tone: 'muted', style: styles.kicker},
        KICKER_LABEL,
      ),
      React.createElement(AppText, {key: 'section', weight: 'semibold'}, section),
      React.createElement(
        AppText,
        {key: 'hint', variant: 'caption', tone: 'muted'},
        UNAVAILABLE_HINT,
      ),
    ],
  });
}

export const AccordionSection: PlaceholderComponent<AccordionSectionProps> = () =>
  renderPlaceholder('Accordion section');

export const HealthProbesSection = (): ReactElement =>
  renderPlaceholder('Health probes');

export const BackendStatusSection = (): ReactElement =>
  renderPlaceholder('Backend status');

export const ServiceHealthSection = (): ReactElement =>
  renderPlaceholder('Service health');

export const InfrastructureSection = (): ReactElement =>
  renderPlaceholder('Infrastructure');

export const DataPipelineSection = (): ReactElement =>
  renderPlaceholder('Data pipeline');

export const OperationsSection = (): ReactElement =>
  renderPlaceholder('Operations');

export const AnomalyInlineRow = (): ReactElement => renderPlaceholder('Anomaly');

export const BackupActionsCard: PlaceholderComponent<BackupActionsCardProps> = () =>
  renderPlaceholder('Backup actions');

export const TeslaAuthCard: PlaceholderComponent<TeslaAuthCardProps> = () =>
  renderPlaceholder('Tesla auth');

export const TeslaApiUsageCard: PlaceholderComponent<TeslaApiUsageCardProps> = () =>
  renderPlaceholder('Tesla API usage');

export const TelemetryPipelineCard: PlaceholderComponent<
  TelemetryPipelineCardProps
> = () => renderPlaceholder('Telemetry pipeline');

export const UpdateAvailableCallout: PlaceholderComponent<
  UpdateAvailableCalloutProps
> = () => renderPlaceholder('Update available');

export function StatusPageSkeleton(): ReactElement {
  return React.createElement(GlassPanel, {
    style: styles.panel,
    children: [
      React.createElement(View, {
        key: 'bar-hero',
        style: [styles.skeletonBar, styles.skeletonBarHero],
      }),
      React.createElement(View, {
        key: 'bar-wide',
        style: [styles.skeletonBar, styles.skeletonBarWide],
      }),
      React.createElement(View, {key: 'bar', style: styles.skeletonBar}),
      React.createElement(View, {
        key: 'bar-narrow',
        style: [styles.skeletonBar, styles.skeletonBarNarrow],
      }),
    ],
  });
}

export const LiveStatusPill: PlaceholderComponent<LiveStatusPillProps> = () =>
  renderPlaceholder('Live status');

export const IncidentsCard: PlaceholderComponent<IncidentsCardProps> = () =>
  renderPlaceholder('Incidents');

export const IncidentForm: PlaceholderComponent<IncidentFormProps> = () =>
  renderPlaceholder('Incident form');

export const ScheduledMaintenanceCard: PlaceholderComponent<
  ScheduledMaintenanceCardProps
> = () => renderPlaceholder('Scheduled maintenance');

export const SubscribeCard = (): ReactElement => renderPlaceholder('Subscribe');

export const SLOTrackingCard = (): ReactElement =>
  renderPlaceholder('SLO tracking');

export const FrontendErrorsCard = (): ReactElement =>
  renderPlaceholder('Frontend errors');

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  kicker: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  skeletonBar: {
    height: 14,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.sm,
  },
  skeletonBarHero: {
    height: 28,
    width: '60%',
  },
  skeletonBarWide: {
    width: '80%',
  },
  skeletonBarNarrow: {
    width: '45%',
  },
});
