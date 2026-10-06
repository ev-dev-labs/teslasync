import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWatchSummary, useWatchCommand } from '@/api/hooks/useWatch';
import { Skeleton } from '@/components/feedback';
import { Badge, Text, Button as ControlButton } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import { cn } from '@/lib/cn';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { OperationalModeBadge, ProgressRing } from '@/components/data-display';
import {
  convertDistanceFromSI,
  convertTempFromSI,
  type DistanceUnitPref,
} from '@/lib/unitConversion';
import { Zap, Lock, Unlock, Thermometer, Shield } from 'lucide-react';
import { AIWatchFaceNLResponse } from '@/components/ai/AIWatchFaceNLResponse';

/**
 * Watch-optimized page for Apple Watch / Wear OS.
 * Designed for 40-45mm displays (~180×180px viewport):
 * - Black OLED background
 * - Large battery gauge
 * - Tap-friendly status icons (44px+ targets)
 * - No scrolling — single screen
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
 *   opt in can scroll to use the Helix panel; wearables never
 *   see it.
 */
export default function WatchFacePage() {
  const { t } = useTranslation();
  const { vehicleId: selectedVehicleId } = useSelectedVehicle();
  const vehicleId = selectedVehicleId ?? undefined;
  const summaryQuery = useWatchSummary(vehicleId);
  const { data, isLoading } = summaryQuery;
  const source = deriveDataState({ ...summaryQuery, data: data ?? undefined }, { provenance: 'live' });
  const commandMutation = useWatchCommand();
  const operationalMode = useOperationalMode();
  const { unitPrefs } = useUnits();

  const { mutate: sendWatchCommand } = commandMutation;
  const sendCommand = useCallback(
    (command: string) => {
      if (!operationalMode.canWrite) return;
      sendWatchCommand({ vehicleId, command });
    },
    [operationalMode.canWrite, sendWatchCommand, vehicleId],
  );

  // Render the wearable WatchShell first as the primary surface;
  // the opt-in Helix narrator is appended as a sibling AFTER so
  // off-mode users see ONLY the chrome-less wearable shell
  // (withAiFeature returns null → the sibling is absent from the
  // DOM, preserving the wearable invariant).
  let watchContent: React.ReactNode;
  if (isLoading && !source.hasData) {
    watchContent = (
      <div
        role="status"
        aria-busy="true"
        aria-label={t('watch.loading', 'Loading watch summary…')}
        className="flex h-full flex-col items-center"
      >
        <Skeleton className="h-3 w-24" />
        <div className="flex flex-1 items-center justify-center">
          <Skeleton rounded className="h-32 w-32" />
        </div>
        <div className="flex gap-4 pb-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} rounded className="h-11 w-11" />
          ))}
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
    );
  } else if (source.fatalError || !data) {
    watchContent = (
      <Text as="p" variant="bodySm" className="px-4 text-center text-[var(--text-on-accent)]">
        {source.fatalError ? String(source.fatalError) : t('watch.noVehicle', 'No vehicle found')}
      </Text>
    );
  } else {
    // SI boundary: backend `range_km` is in km, derived in
    // watch_handler.go as RatedRange*1.60934. Multiply by 1000 before
    // passing it to convertDistanceFromSI.
    const displayRange = Number.isFinite(data.range_km)
      ? convertDistanceFromSI(data.range_km * 1000, unitPrefs.distance) : null;
    // SI boundary: backend `inside_temp_c` is already °C (SI for temp).
    const displayInsideTemp = Number.isFinite(data.inside_temp_c)
      ? convertTempFromSI(data.inside_temp_c, unitPrefs.temperature) : null;
    const batteryLevel = Number.isFinite(data.battery_level) ? data.battery_level : null;

    watchContent = (
      <>
        {/* Vehicle name */}
        <Text variant="caption" className="px-2 text-center text-[var(--text-on-accent)]">
          {data.vehicle_name}
        </Text>
        {source.refreshError && (
          <Badge variant="warning" size="sm" className="mx-auto" role="status">
            {t('watch.cached', 'Cached')}
          </Badge>
        )}
        {operationalMode.isReadOnly && (
          <div className="flex justify-center pt-1">
            <OperationalModeBadge compact />
          </div>
        )}

        {/* Battery gauge — center focus */}
        <div className="flex-1 flex flex-col items-center justify-center min-h-0">
          <BatteryGauge
            level={batteryLevel}
            rangeDisplay={displayRange}
            distanceUnit={unitPrefs.distance}
          />

          {/* Charging status */}
          {data.is_charging && (
            <div className="mt-2 flex items-center gap-1 text-emerald-400 text-xs">
              <Zap className="h-3 w-3" />
              <span>
                {t('watch.timeToFull', '{{minutes}}m to full', {
                  minutes: Math.round(data.time_to_full ?? 0),
                })}
              </span>
            </div>
          )}

          {/* State badge */}
          <Badge
            variant={watchStateVariant(data.state)}
            size="sm"
            className={cn('mt-2 text-2xs font-medium', watchStateClassName(data.state))}
          >
            {data.state}
          </Badge>
        </div>

        {/* Quick action icons */}
        <div className="flex justify-center gap-4 pb-2">
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
            disabled={!operationalMode.canWrite}
            disabledReason={operationalMode.writeBlockReason ?? undefined}
          />
          <StatusIcon
            icon={Thermometer}
            active={data.is_climate_on}
            label={displayInsideTemp == null ? '—' : `${Math.round(displayInsideTemp)}°`}
            ariaLabel={
              data.is_climate_on
                ? t('watch.action.climateOff', 'Turn climate off')
                : t('watch.action.climateOn', 'Turn climate on')
            }
            onClick={() => sendCommand(data.is_climate_on ? 'climate_off' : 'climate_on')}
            loading={commandMutation.isPending}
            disabled={!operationalMode.canWrite}
            disabledReason={operationalMode.writeBlockReason ?? undefined}
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

        {/* Last updated */}
        <div className="text-2xs text-[var(--text-muted)] text-center">
          {formatRelativeTime(data.last_updated)}
        </div>

        {/* PWA meta tags (injected via effect) */}
        <WatchPWAMeta />
      </>
    );
  }

  return (
    <>
      <WatchShell>{watchContent}</WatchShell>
      {/*
        Opt-in Helix narrator. Rendered as a sibling AFTER <WatchShell>
        so the chrome-less wearable
        layout above is unaffected. withAiFeature returns null
        when ai_mode='off' or the per-feature toggle is off,
        keeping the wearable invariant ("single screen, no
        scroll") intact. On desktop/tablet with AI on, this
        panel renders below the watch shell for opt-in
        natural-language Q&A about the current watch face.
      */}
      <AIWatchFaceNLResponse />
    </>
  );
}

// --- Sub-components ---

function WatchShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen bg-black text-[var(--text-on-accent)] flex flex-col p-3 select-none overflow-hidden">
      {children}
    </div>
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
  const knownLevel = level != null && Number.isFinite(level);
  const color = knownLevel ? getBatteryColor(level) : 'var(--text-on-accent)';
  const levelLabel = knownLevel ? `${level}%` : '—';
  const rangeLabel = rangeDisplay != null && Number.isFinite(rangeDisplay)
    ? `${Math.round(rangeDisplay)} ${distanceUnit}` : '—';

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
   * Accessible name for the control. Icon-only buttons (lock, sentry) carry no
   * visible text, so an explicit label is required for screen readers; when
   * omitted we fall back to the visible `label`.
   */
  ariaLabel?: string;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export function StatusIcon({ icon: Icon, active, color, label, ariaLabel, onClick, loading, disabled = false, disabledReason }: StatusIconProps) {
  const colorClasses = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
  };
  const activeColor = color ? colorClasses[color] : 'text-cyan-400';

  return (
    <ControlButton
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={loading || disabled}
      title={disabled ? disabledReason : undefined}
      className={cn(
        'h-11 w-11 flex-col rounded-full px-0 py-0 font-normal transition-colors duration-normal',
        active ? `bg-[var(--surface-2)] ${activeColor}` : 'bg-[var(--surface-2)] text-[var(--text-muted)]',
        onClick && 'active:scale-95',
        (loading || disabled) && 'opacity-50',
      )}
      aria-label={ariaLabel ?? label}
    >
      <Icon className="h-4 w-4" />
      {label && <span className="text-2xs mt-0.5" aria-hidden="true">{label}</span>}
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
  if (level > 40) return '#22c55e'; // green
  if (level > 20) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

export function watchStateVariant(state: string): 'info' | 'success' | 'neutral' {
  if (state === 'driving') return 'info';
  if (state === 'charging') return 'success';
  return 'neutral';
}

export function watchStateClassName(state: string): string {
  switch (state) {
    case 'driving':
      return 'bg-blue-500/20 text-blue-400';
    case 'charging':
      return 'bg-emerald-500/20 text-emerald-400';
    case 'asleep':
      return 'bg-[var(--surface-2)] text-[var(--text-muted)]';
    case 'online':
      return 'bg-[var(--surface-2)] text-[var(--text-secondary)]';
    default:
      return '';
  }
}

export function formatRelativeTime(isoTimestamp: string): string {
  if (!isoTimestamp) return '';
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
