import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery, Zap, Plug } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/* ── Animated dots flowing along an SVG path ────────────────── */

interface FlowDotsProps {
  pathId: string;
  color: string;
  count: number;
  /** Duration for one full path traversal (seconds) */
  duration: number;
  active: boolean;
}

function FlowDots({ pathId, color, count, duration, active }: FlowDotsProps) {
  if (!active) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} r={3} fill={color} opacity={0.9}>
          <animateMotion
            dur={`${duration}s`}
            repeatCount="indefinite"
            begin={`${(i * duration) / count}s`}
          >
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
}

/* ── SVG Node label ─────────────────────────────────────────── */

interface NodeProps {
  x: number;
  y: number;
  label: string;
  sublabel?: string;
  color: string;
  icon: 'battery' | 'drive' | 'charger';
}

function FlowNode({ x, y, label, sublabel, color }: NodeProps) {
  return (
    <g>
      <circle cx={x} cy={y} r={22} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={1.5} strokeOpacity={0.5} />
      <text x={x} y={y - 4} textAnchor="middle" fill={color} fontSize={11} fontWeight={700}>
        {label}
      </text>
      {sublabel && (
        <text x={x} y={y + 10} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize={8}>
          {sublabel}
        </text>
      )}
    </g>
  );
}

/* ── Power label on a path ──────────────────────────────────── */

function PathLabel({ x, y, value, unit, color }: { x: number; y: number; value: string; unit: string; color: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fill={color} fontSize={9} fontWeight={600}>
      {value} {unit}
    </text>
  );
}

/* ── Compact fallback (1-column / small) ────────────────────── */

function CompactView({ power, chargerPower, isCharging, batteryLevel, t }: {
  power: number;
  chargerPower: number;
  isCharging: boolean;
  batteryLevel: number;
  t: (key: string, fallback: string) => string;
}) {
  const isConsuming = power > 0.5;
  const isRegen = power < -0.5;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 py-2">
      <div className="text-xl font-bold text-white/90">{batteryLevel}%</div>
      {isCharging && (
        <div className="flex items-center gap-1 text-xs text-amber-400">
          <Plug className="h-3 w-3" />
          <span>{fmtNumber(chargerPower, 1)} kW</span>
        </div>
      )}
      {isConsuming && (
        <div className="flex items-center gap-1 text-xs text-cyan-400">
          <Zap className="h-3 w-3" />
          <span>{fmtNumber(power, 1)} kW</span>
        </div>
      )}
      {isRegen && (
        <div className="flex items-center gap-1 text-xs text-emerald-400">
          <Battery className="h-3 w-3" />
          <span>{fmtNumber(Math.abs(power), 1)} kW</span>
        </div>
      )}
      {!isConsuming && !isRegen && !isCharging && (
        <span className="text-xs text-white/40">{t('widget.energyFlowAnimated.idle', 'Idle')}</span>
      )}
    </div>
  );
}

/* ── Main widget ────────────────────────────────────────────── */

const CYAN = '#22d3ee';
const GREEN = '#34d399';
const AMBER = '#fbbf24';

export default function EnergyFlowAnimatedWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id, { refetchInterval: 5_000 });
  const state = stateData?.state;

  const power = state?.power ?? 0;
  const chargerPower = state?.charger_power ?? 0;
  const batteryLevel = state?.battery_level ?? 0;
  const isCharging = state?.is_charging ?? false;
  const isConsuming = power > 0.5;
  const isRegen = power < -0.5;
  const absPower = Math.abs(power);

  // Animation speed: faster flow = more power (clamp between 1s and 4s)
  const driveDuration = useMemo(() => Math.max(1, 4 - Math.min(absPower / 50, 3)), [absPower]);
  const chargeDuration = useMemo(() => Math.max(1, 4 - Math.min(chargerPower / 50, 3)), [chargerPower]);

  const isCompact = size.cols < 2;
  const isWide = size.cols >= 3;

  return (
    <WidgetShell
      title={t('widget.energyFlowAnimated.title', 'Energy Flow')}
      icon={<Zap className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      noPadding
    >
      {state ? (
        isCompact ? (
          <CompactView
            power={power}
            chargerPower={chargerPower}
            isCharging={isCharging}
            batteryLevel={batteryLevel}
            t={t}
          />
        ) : (
          <div className="h-full w-full px-2 pb-2">
            <svg
              viewBox={isWide ? '0 0 360 180' : '0 0 280 180'}
              className="w-full h-full"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                {/* Battery → Drive path */}
                <path
                  id="path-drive"
                  d={isWide ? 'M 70 100 C 140 100, 220 100, 290 100' : 'M 60 100 C 110 100, 170 100, 220 100'}
                  fill="none"
                />
                {/* Drive → Battery (regen, reverse) */}
                <path
                  id="path-regen"
                  d={isWide ? 'M 290 100 C 220 120, 140 120, 70 100' : 'M 220 100 C 170 120, 110 120, 60 100'}
                  fill="none"
                />
                {/* Charger → Battery */}
                <path
                  id="path-charge"
                  d={isWide ? 'M 180 30 C 150 50, 100 70, 70 100' : 'M 140 30 C 120 50, 90 70, 60 100'}
                  fill="none"
                />
              </defs>

              {/* Static path traces (dim background lines) */}
              <use
                href="#path-drive"
                stroke={isConsuming ? CYAN : 'rgba(255,255,255,0.06)'}
                strokeWidth={isConsuming ? 2 : 1}
                strokeDasharray={isConsuming ? undefined : '4 4'}
                fill="none"
                strokeLinecap="round"
              />
              <use
                href="#path-regen"
                stroke={isRegen ? GREEN : 'rgba(255,255,255,0.06)'}
                strokeWidth={isRegen ? 2 : 1}
                strokeDasharray={isRegen ? undefined : '4 4'}
                fill="none"
                strokeLinecap="round"
              />
              <use
                href="#path-charge"
                stroke={isCharging ? AMBER : 'rgba(255,255,255,0.06)'}
                strokeWidth={isCharging ? 2 : 1}
                strokeDasharray={isCharging ? undefined : '4 4'}
                fill="none"
                strokeLinecap="round"
              />

              {/* Animated flow dots */}
              <FlowDots pathId="path-drive" color={CYAN} count={4} duration={driveDuration} active={isConsuming} />
              <FlowDots pathId="path-regen" color={GREEN} count={4} duration={driveDuration} active={isRegen} />
              <FlowDots pathId="path-charge" color={AMBER} count={3} duration={chargeDuration} active={isCharging} />

              {/* Power labels */}
              {isConsuming && (
                <PathLabel
                  x={isWide ? 180 : 140}
                  y={93}
                  value={fmtNumber(absPower, 1)}
                  unit="kW"
                  color={CYAN}
                />
              )}
              {isRegen && (
                <PathLabel
                  x={isWide ? 180 : 140}
                  y={138}
                  value={fmtNumber(absPower, 1)}
                  unit="kW"
                  color={GREEN}
                />
              )}
              {isCharging && (
                <PathLabel
                  x={isWide ? 115 : 90}
                  y={55}
                  value={fmtNumber(chargerPower, 1)}
                  unit="kW"
                  color={AMBER}
                />
              )}

              {/* Nodes */}
              <FlowNode
                x={isWide ? 70 : 60}
                y={100}
                label={`${batteryLevel}%`}
                sublabel={t('widget.energyFlowAnimated.battery', 'Battery')}
                color={batteryLevel > 20 ? GREEN : '#ef4444'}
                icon="battery"
              />
              <FlowNode
                x={isWide ? 290 : 220}
                y={100}
                label={
                  isConsuming
                    ? t('widget.energyFlowAnimated.drive', 'Drive')
                    : isRegen
                      ? t('widget.energyFlowAnimated.regen', 'Regen')
                      : t('widget.energyFlowAnimated.idle', 'Idle')
                }
                sublabel={
                  isConsuming || isRegen ? `${fmtNumber(absPower, 1)} kW` : undefined
                }
                color={isConsuming ? CYAN : isRegen ? GREEN : 'rgba(255,255,255,0.3)'}
                icon="drive"
              />
              <FlowNode
                x={isWide ? 180 : 140}
                y={30}
                label={
                  isCharging
                    ? `${fmtNumber(chargerPower, 0)} kW`
                    : '—'
                }
                sublabel={t('widget.energyFlowAnimated.charger', 'Charger')}
                color={isCharging ? AMBER : 'rgba(255,255,255,0.15)'}
                icon="charger"
              />
            </svg>
          </div>
        )
      ) : (
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.energyFlowAnimated.noData', 'No energy data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
