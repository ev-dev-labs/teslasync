import { useCallback, useEffect, useId } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useWatchSummary, useWatchCommand } from '@/api/hooks/useWatch';
import { QueryError, Skeleton } from '@/components/feedback';
import { Accordion, Badge, Heading, Text, Button as ControlButton } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/resilience';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { usePageTitle } from '@/hooks/usePageTitle';
import { gaugeTone, severityTokens, typography } from '@/lib/tokens';
import { OperationalModeBadge, ProgressRing } from '@/components/data-display';
import {
  convertDistanceFromSI,
  convertTempFromSI,
  type DistanceUnitPref,
} from '@/lib/unitConversion';
import { Zap, Lock, Unlock, Thermometer, Shield } from 'lucide-react';
import { AIWatchFaceNLResponse } from '@/components/ai';

/**
 * Watch-optimized page for Apple Watch / Wear OS.
 * Designed for 40-45mm displays (~180×180px viewport):
 * - Black OLED background
 * - Large battery gauge
 * - Tap-friendly status icons (44px+ targets)
 * - A single glance surface, with reachable scrolling on small/scaled displays
 * - Auto-refresh every 30s
 * EXCEPTION: watch/PWA route is chrome-less to fit 40-45mm wearable displays.
 *
 * Opt-in Helix narrator:
 *   The deterministic <WatchShell> + fixed cards + tap commands
 *   above are the canonical baseline visible to every user
 *   (the ONLY view when AI is off — the wearable contract). When
 *   ai_mode is on AND the watch-face-nl-response toggle is on,
 *   <AIWatchFaceNLResponse /> renders an OPT-IN narration panel
 *   BELOW the watch shell. withAiFeature returns null in off
 *   mode so the wearable chrome-less invariant holds (no second
 *   element in the doc flow at all). Desktop/tablet users who
 *   opt in can scroll to use the Helix panel, including on wearables.
 */
export default function WatchFacePage() {
  const { t } = useTranslation();
  const title = t('routes.watchFace', 'Watch face');
  usePageTitle(title);
  const readOnlyDescriptionId = useId();
  const { vehicleId: selectedVehicleId } = useSelectedVehicle();
  const vehicleId = selectedVehicleId ?? undefined;
  const summaryQuery = useWatchSummary(vehicleId);
  const { data, isLoading } = summaryQuery;
  const source = deriveDataState({ ...summaryQuery, data: data ?? undefined }, { provenance: 'live' });
  const commandMutation = useWatchCommand();
  const operationalMode = useOperationalMode();
  const { unitPrefs } = useUnits();
  const { fmtInt } = useNumberFormatting();
  const accessUnavailable = summaryQuery.availability === 'not-configured'
    || summaryQuery.availability === 'prerequisite-error';
  const canCommand = operationalMode.canWrite && !accessUnavailable;
  const disabledReason = operationalMode.writeBlockReason
    ?? (summaryQuery.availability === 'prerequisite-error'
      ? t('watch:capability.readError', 'Watch access could not be checked')
      : accessUnavailable ? t('watch:capability.notConfigured', 'Watch access is not configured') : undefined);
  const accessOwnsDescription = accessUnavailable && operationalMode.writeBlockReason == null;
  const accessNotice = accessUnavailable ? (
    <div className="min-w-0 space-y-2 text-center">
      <Text as="p" id={accessOwnsDescription ? readOnlyDescriptionId : undefined} variant="bodySm" className="break-words text-[var(--text-on-accent)]">
        {summaryQuery.availability === 'prerequisite-error'
          ? t('watch:capability.readError', 'Watch access could not be checked')
          : t('watch:capability.notConfigured', 'Watch access is not configured')}
      </Text>
      <Text as="p" variant="caption" className="break-words text-[var(--text-on-accent)]">
        {summaryQuery.availability === 'prerequisite-error'
          ? t('watch:capability.readErrorDescription', 'Watch access is unknown because browser session storage could not be read or saved. Retry after storage becomes available. Retained readings remain visible.')
          : t('watch:capability.description', 'Watch readings require a wearable API key in this session. Manage API keys and open your configured watch link to enable readings. Retained readings are not refreshed until access is configured.')}
      </Text>
      {summaryQuery.availability === 'prerequisite-error' ? (
        <ControlButton wrapLabel variant="secondary" className="min-h-11" onClick={summaryQuery.recheckAvailability}>
          {t('error.retry', 'Retry')}
        </ControlButton>
      ) : (
        <Link to="/api-keys" className="inline-flex min-h-11 items-center underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          {t('watch:capability.configure', 'Manage API keys')}
        </Link>
      )}
    </div>
  ) : null;

  const { mutate: sendWatchCommand } = commandMutation;
  const sendCommand = useCallback(
    (command: string) => {
      if (!canCommand || commandMutation.isPending) return;
      sendWatchCommand({ vehicleId, command });
    },
    [canCommand, commandMutation.isPending, sendWatchCommand, vehicleId],
  );

  // Render the wearable WatchShell first as the primary surface;
  // the opt-in Helix narrator is appended as a sibling AFTER so
  // off-mode users see ONLY the chrome-less wearable shell
  // (withAiFeature returns null → the sibling is absent from the
  // DOM, preserving the wearable invariant).
  let watchContent: React.ReactNode;
  if (isLoading && !source.hasData && !source.isRefreshBlocked) {
    watchContent = (
      <div
        role="status"
        aria-busy="true"
        aria-label={t('watch.loading', 'Loading watch summary…')}
        className="flex min-h-full shrink-0 flex-col items-center gap-2"
      >
        <Skeleton className="h-3 w-24" />
        <div className="flex flex-1 shrink-0 items-center justify-center">
          <Skeleton rounded className="h-32 w-32" />
        </div>
        <div className="flex gap-2 pb-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} rounded className="h-11 w-11" />
          ))}
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
    );
  } else if (!data && accessUnavailable) {
    watchContent = accessNotice;
  } else if (!data && !source.fatalError && (source.isRefreshBlocked || operationalMode.isReadOnly)) {
    watchContent = (
      <div className="min-w-0 space-y-2 px-4 text-center">
        {source.isRefreshBlocked ? (
          <Badge variant="warning" size="sm" role="status">
            {t('dataSources.status.paused', 'Refresh paused')}
          </Badge>
        ) : null}
        {operationalMode.isReadOnly ? (
          <>
            <div className="flex justify-center">
              <OperationalModeBadge compact />
            </div>
            <Text as="p" variant="bodySm" className="break-words text-[var(--text-on-accent)]">
              {operationalMode.description}
            </Text>
          </>
        ) : null}
      </div>
    );
  } else if (source.fatalError || !data) {
    watchContent = (
      <div className="min-w-0 space-y-2">
        {source.fatalError ? (
          <WatchRecovery error={source.fatalError} onRetry={source.retry ?? undefined} />
        ) : (
          <Text as="p" variant="bodySm" className="break-words text-center text-[var(--text-on-accent)]">
            {t('watch.noVehicle', 'No vehicle found')}
          </Text>
        )}
      </div>
    );
  } else {
    const displayRange = Number.isFinite(data.range_m)
      ? convertDistanceFromSI(data.range_m, unitPrefs.distance) : null;
    // SI boundary: backend `inside_temp_c` is already °C (SI for temp).
    const displayInsideTemp = Number.isFinite(data.inside_temp_c)
      ? convertTempFromSI(data.inside_temp_c, unitPrefs.temperature) : null;
    const batteryLevel = Number.isFinite(data.battery_level) ? data.battery_level : null;

    watchContent = (
      <>
        {accessNotice}
        {/* Vehicle name */}
        <Text variant="caption" className="min-w-0 break-words px-2 text-center text-[var(--text-on-accent)] [overflow-wrap:anywhere]">
          {data.vehicle_name}
        </Text>
        {(source.refreshError || source.isRefreshBlocked) && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant="warning" size="sm" role="status">
              {t('watch.cached', 'Cached')}
            </Badge>
          </div>
        )}
        {source.refreshError && !accessUnavailable ? (
          <WatchRecovery error={source.refreshError} onRetry={source.retry ?? undefined} />
        ) : null}
        {operationalMode.isReadOnly && (
          <div className="flex justify-center pt-1">
            <OperationalModeBadge compact />
          </div>
        )}

        {/* Battery gauge — center focus */}
        <div className="flex flex-1 shrink-0 flex-col items-center justify-center">
          <BatteryGauge
            level={batteryLevel}
            rangeDisplay={displayRange}
            distanceUnit={unitPrefs.distance}
          />

          {/* Charging status */}
          {data.is_charging && (
            <div className="mt-2 flex min-w-0 items-center gap-1">
              <Zap className={cn('h-3 w-3 shrink-0', severityTokens.success.fg)} aria-hidden="true" />
              <Text variant="caption" className={cn('min-w-0 break-words', severityTokens.success.fg)}>
                {data.time_to_full != null && Number.isFinite(data.time_to_full)
                  ? t('watch.timeToFull', '{{minutes}}m to full', {
                      minutes: fmtInt(data.time_to_full),
                    })
                  : t('watch.timeToFullUnknown', 'Time to full unknown')}
              </Text>
            </div>
          )}

          {/* State badge */}
          <Badge
            variant={watchStateVariant(data.state)}
            size="sm"
            className="mt-2"
          >
            {data.state ? t(`watch.state.${data.state}`, data.state) : t('common.unknown', 'Unknown')}
          </Badge>
        </div>

        {/* Quick action icons */}
        <div className="flex shrink-0 flex-wrap justify-center gap-2 pb-2">
          <StatusIcon
            icon={data.is_locked ? Lock : Unlock}
            active={data.is_locked}
            color={data.is_locked ? 'emerald' : 'red'}
            ariaLabel={
              data.is_locked
                ? t('watch.action.unlock', 'Unlock vehicle')
                : t('watch.action.lock', 'Lock vehicle')
            }
            onClick={() => sendCommand(data.is_locked ? 'unlock' : 'lock')}
            loading={commandMutation.isPending}
            disabled={!canCommand}
            disabledReason={disabledReason}
            describedBy={disabledReason ? readOnlyDescriptionId : undefined}
          />
          <StatusIcon
            icon={Thermometer}
            active={data.is_climate_on}
            label={displayInsideTemp == null ? '—' : `${fmtInt(displayInsideTemp)}°`}
            ariaLabel={
              data.is_climate_on
                ? t('watch.action.climateOff', 'Turn climate off')
                : t('watch.action.climateOn', 'Turn climate on')
            }
            onClick={() => sendCommand(data.is_climate_on ? 'climate_off' : 'climate_on')}
            loading={commandMutation.isPending}
            disabled={!canCommand}
            disabledReason={disabledReason}
            describedBy={disabledReason ? readOnlyDescriptionId : undefined}
          />
          <StatusIcon
            icon={Shield}
            active={data.sentry_mode}
            color={data.sentry_mode ? 'amber' : undefined}
            ariaLabel={
              data.sentry_mode
                ? t('watch.sentryOn', 'Sentry mode on')
                : t('watch.sentryOff', 'Sentry mode off')
            }
          />
        </div>
        {disabledReason && !accessOwnsDescription ? (
          <Text as="p" id={readOnlyDescriptionId} variant="caption" className="break-words text-center text-[var(--text-on-accent)]">
            {disabledReason}
          </Text>
        ) : null}

        {/* Last updated */}
        <Text as="div" variant="caption" className="text-center">
          {formatRelativeTime(data.last_updated, (key, fallback, count) => t(key, fallback, { count }))}
        </Text>

        {/* PWA meta tags (injected via effect) */}
        <WatchPWAMeta />
      </>
    );
  }

  return (
    <>
      <WatchShell>
        <Heading as="h1" level="page" className="sr-only">{title}</Heading>
        {watchContent}
      </WatchShell>
      {/*
        Opt-in Helix narrator. Rendered as a sibling AFTER <WatchShell>
        so the chrome-less wearable
        layout above is unaffected. withAiFeature returns null
        when ai_mode='off' or the per-feature toggle is off,
        keeping the deterministic wearable surface intact. With AI on,
        this panel renders below the watch shell for opt-in
        natural-language Q&A about the current watch face.
      */}
      <AIWatchFaceNLResponse />
    </>
  );
}

// --- Sub-components ---

function WatchRecovery({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { t } = useTranslation();
  // Only the bounded HTTP status is safe to disclose; messages, URLs and stacks
  // can include the wearable key or private vehicle information.
  const status = isApiError(error) && Number.isInteger(error.status)
    && error.status >= 100 && error.status <= 599 ? error.status : null;

  return (
    <div className="min-w-0 space-y-2">
      <QueryError error={error} onRetry={onRetry} compact className="mb-0 [&_button]:min-h-11" />
      {status != null ? (
        <Accordion
          title={t('common.learnMore', 'Learn more')}
          headerClassName="min-h-11 px-3 py-2"
          bodyClassName="px-3 py-2"
        >
          <Text as="p" variant="caption" className="break-words">
            {t('common.status', 'Status')}: HTTP {status}
          </Text>
        </Accordion>
      ) : null}
    </div>
  );
}

function WatchShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex h-dvh min-w-0 flex-col gap-2 overflow-y-auto bg-black p-3 text-[var(--text-on-accent)] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]">
      {children}
    </main>
  );
}

export function BatteryGauge({
  level,
  rangeDisplay,
  distanceUnit,
}: {
  level: number | null;
  rangeDisplay: number | null;
  distanceUnit: DistanceUnitPref;
}) {
  const { t } = useTranslation();
  const { fmtPercent, fmtWithUnit } = useNumberFormatting();
  const knownLevel = level != null && Number.isFinite(level);
  const color = knownLevel ? getBatteryColor(level) : gaugeTone.neutral;
  // Whole-number labels fit the watch; color and arc retain the raw measurement.
  const levelLabel = knownLevel ? fmtPercent(level, 0) : '—';
  const rangeLabel = rangeDisplay != null && Number.isFinite(rangeDisplay)
    ? fmtWithUnit(rangeDisplay, distanceUnit, 0) : '—';

  return (
    <ProgressRing
      value={knownLevel ? level : Number.NaN}
      size={128}
      strokeWidth={10}
      color={color}
      ariaLabel={t('watch.batteryGauge', 'Battery {{battery}}; range {{range}}', {
        battery: knownLevel ? levelLabel : t('common.unknown', 'Unknown'),
        range: rangeLabel,
      })}
      centerLabel={<Text variant="metricValue" className="text-[var(--text-on-accent)]">{levelLabel}</Text>}
      centerSubLabel={<Text variant="caption" className="text-[var(--text-on-accent)]">{rangeLabel}</Text>}
    />
  );
}

export interface StatusIconProps {
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  color?: 'emerald' | 'red' | 'amber';
  label?: string;
  /**
   * Accessible name for the action or status. Icon-only lock/sentry icons carry no
   * visible text, so an explicit label is required for screen readers; when
   * omitted we fall back to the visible `label`.
   */
  ariaLabel?: string;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  describedBy?: string;
}

export function StatusIcon({ icon: Icon, active, color, label, ariaLabel, onClick, loading, disabled = false, disabledReason, describedBy }: StatusIconProps) {
  const colorClasses = {
    emerald: severityTokens.success.fg,
    red: severityTokens.critical.fg,
    amber: severityTokens.warn.fg,
  };
  const activeColor = color ? colorClasses[color] : severityTokens.info.fg;
  const className = cn(
    'flex h-auto min-h-11 min-w-11 w-11 shrink-0 flex-col items-center justify-center rounded-full px-0 py-0',
    active ? activeColor : typography.color.muted,
    'bg-[var(--surface-2)] forced-colors:text-[CanvasText]',
  );
  const content = (
    <>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label && <Text variant="caption" className="mt-0.5" aria-hidden="true">{label}</Text>}
    </>
  );
  if (!onClick) {
    return <span role="img" aria-label={ariaLabel ?? label} className={className}>{content}</span>;
  }

  return (
    <ControlButton
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={loading || disabled}
      title={disabled ? disabledReason : undefined}
      className={cn(className, typography.weight.regular)}
      aria-label={ariaLabel ?? label}
      aria-describedby={describedBy}
      aria-busy={loading || undefined}
    >
      {content}
    </ControlButton>
  );
}

// --- PWA Meta ---

export function WatchPWAMeta() {
  useEffect(() => {
    const setMeta = (name: string, content: string) => {
      let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
      const existed = Boolean(tag);
      const previous = tag?.getAttribute('content');
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', name);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
      return () => {
        if (!tag) return;
        if (!existed) {
          tag.remove();
        } else if (previous != null) {
          tag.setAttribute('content', previous);
        }
      };
    };

    const cleanupMeta = [
      setMeta('apple-mobile-web-app-capable', 'yes'),
      setMeta('apple-mobile-web-app-status-bar-style', 'black'),
      setMeta('theme-color', '#000000'),
    ];

    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const linkExisted = Boolean(link);
    const previousHref = link?.getAttribute('href');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.href = '/watch-manifest.json';

    return () => {
      cleanupMeta.forEach(cleanup => cleanup());
      if (!link) return;
      if (!linkExisted) {
        link.remove();
      } else if (previousHref != null) {
        link.href = previousHref;
      }
    };
  }, []);

  return null;
}

// --- Utilities ---

export function getBatteryColor(level: number): string {
  if (level > 40) return gaugeTone.success;
  if (level > 20) return gaugeTone.warning;
  return gaugeTone.danger;
}

export function watchStateVariant(state: string): 'info' | 'success' | 'neutral' {
  if (state === 'driving') return 'info';
  if (state === 'charging') return 'success';
  return 'neutral';
}

export function watchStateClassName(state: string): string {
  switch (state) {
    case 'driving':
      return severityTokens.info.fg;
    case 'charging':
      return severityTokens.success.fg;
    case 'asleep':
      return 'bg-[var(--surface-2)] text-[var(--text-muted)]';
    case 'online':
      return 'bg-[var(--surface-2)] text-[var(--text-secondary)]';
    default:
      return '';
  }
}

export function formatRelativeTime(
  isoTimestamp: string,
  translate?: (key: string, fallback: string, count?: number) => string,
): string {
  if (!isoTimestamp) return '';
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return translate?.('watch.updated.justNow', 'just now') ?? 'just now';
  if (diffSec < 3600) {
    const count = Math.floor(diffSec / 60);
    return translate?.('watch.updated.minutesAgo', '{{count}}m ago', count) ?? `${count}m ago`;
  }
  if (diffSec < 86400) {
    const count = Math.floor(diffSec / 3600);
    return translate?.('watch.updated.hoursAgo', '{{count}}h ago', count) ?? `${count}h ago`;
  }
  const count = Math.floor(diffSec / 86400);
  return translate?.('watch.updated.daysAgo', '{{count}}d ago', count) ?? `${count}d ago`;
}
