import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWatchSummary, useWatchCommand } from '@/api/hooks/useWatch';
import { Spinner } from '@/components/feedback';
import { Badge, Button as ControlButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { Zap, Lock, Unlock, Thermometer, Shield } from 'lucide-react';

/**
 * Watch-optimized page for Apple Watch / Wear OS.
 * Designed for 40-45mm displays (~180×180px viewport):
 * - Black OLED background
 * - Large battery gauge
 * - Tap-friendly status icons (44px+ targets)
 * - No scrolling — single screen
 * - Auto-refresh every 30s
 * EXCEPTION: watch/PWA route is chrome-less to fit 40-45mm wearable displays.
 */
export default function WatchFacePage() {
  const [searchParams] = useSearchParams();
  const vehicleIdParam = searchParams.get('vehicle_id');
  const vehicleId = vehicleIdParam ? Number(vehicleIdParam) : undefined;
  const { data, isLoading, error } = useWatchSummary(vehicleId);
  const commandMutation = useWatchCommand();

  const sendCommand = (command: string) => {
    commandMutation.mutate({ vehicleId, command });
  };

  if (isLoading) {
    return (
      <WatchShell>
        <Spinner size="lg" />
      </WatchShell>
    );
  }

  if (error || !data) {
    return (
      <WatchShell>
        <p className="text-white/50 text-sm text-center px-4">
          {error ? String(error) : 'No vehicle found'}
        </p>
      </WatchShell>
    );
  }

  return (
    <WatchShell>
      {/* Vehicle name */}
      <div className="text-[10px] text-white/40 text-center truncate px-2">
        {data.vehicle_name}
      </div>

      {/* Battery gauge — center focus */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <BatteryGauge level={data.battery_level} rangeKm={data.range_km} />

        {/* Charging status */}
        {data.is_charging && (
          <div className="mt-2 flex items-center gap-1 text-emerald-400 text-xs">
            <Zap className="h-3 w-3" />
            <span>{Math.round(data.time_to_full)}m to full</span>
          </div>
        )}

        {/* State badge */}
        <Badge
          variant={watchStateVariant(data.state)}
          size="sm"
          className={cn('mt-2 text-[10px] font-medium', watchStateClassName(data.state))}
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
          onClick={() => sendCommand(data.is_locked ? 'unlock' : 'lock')}
          loading={commandMutation.isPending}
        />
        <StatusIcon
          icon={Thermometer}
          active={data.is_climate_on}
          label={`${Math.round(data.inside_temp_c)}°`}
          onClick={() => sendCommand(data.is_climate_on ? 'climate_off' : 'climate_on')}
          loading={commandMutation.isPending}
        />
        <StatusIcon
          icon={Shield}
          active={data.sentry_mode}
          color={data.sentry_mode ? 'amber' : undefined}
        />
      </div>

      {/* Last updated */}
      <div className="text-[8px] text-white/20 text-center">
        {formatRelativeTime(data.last_updated)}
      </div>

      {/* PWA meta tags (injected via effect) */}
      <WatchPWAMeta />
    </WatchShell>
  );
}

// --- Sub-components ---

function WatchShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen bg-black text-white flex flex-col p-3 select-none overflow-hidden">
      {children}
    </div>
  );
}

function BatteryGauge({ level, rangeKm }: { level: number; rangeKm: number }) {
  const color = getBatteryColor(level);
  const dashLength = level * 2.64;

  return (
    <div className="relative w-32 h-32">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        {/* Background ring */}
        <circle
          cx="50" cy="50" r="42" fill="none"
          stroke="rgba(255,255,255,0.1)" strokeWidth="8"
        />
        {/* Battery level arc */}
        <circle
          cx="50" cy="50" r="42" fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dashLength} 264`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold">{level}%</span>
        <span className="text-[10px] text-white/50">
          {Math.round(rangeKm)} km
        </span>
      </div>
    </div>
  );
}

interface StatusIconProps {
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  color?: 'emerald' | 'red' | 'amber';
  label?: string;
  onClick?: () => void;
  loading?: boolean;
}

function StatusIcon({ icon: Icon, active, color, label, onClick, loading }: StatusIconProps) {
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
      disabled={loading}
      className={cn(
        'h-11 w-11 flex-col rounded-full px-0 py-0 font-normal transition-colors duration-200',
        active ? `bg-white/10 ${activeColor}` : 'bg-white/5 text-white/30',
        onClick && 'active:scale-95',
        loading && 'opacity-50',
      )}
      aria-label={label}
    >
      <Icon className="h-4 w-4" />
      {label && <span className="text-[8px] mt-0.5">{label}</span>}
    </ControlButton>
  );
}

// --- PWA Meta ---

function WatchPWAMeta() {
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

function getBatteryColor(level: number): string {
  if (level > 40) return '#22c55e'; // green
  if (level > 20) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

function watchStateVariant(state: string): 'info' | 'success' | 'neutral' {
  if (state === 'driving') return 'info';
  if (state === 'charging') return 'success';
  return 'neutral';
}

function watchStateClassName(state: string): string {
  switch (state) {
    case 'driving':
      return 'bg-blue-500/20 text-blue-400';
    case 'charging':
      return 'bg-emerald-500/20 text-emerald-400';
    case 'asleep':
      return 'bg-white/5 text-white/30';
    case 'online':
      return 'bg-white/10 text-white/60';
    default:
      return '';
  }
}

function formatRelativeTime(isoTimestamp: string): string {
  if (!isoTimestamp) return '';
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
