import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Flag, Trophy, Zap, Gauge, Timer, Swords, MapPin, Route as RouteIcon,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, StatusPill, SelectableCard } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import {
  ComposedChart, LineChart, Line, Area, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, ChartGradient, ChartTooltip, chartGrid, axisTick,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import {
  useSegments, useSegmentLeaderboard, useSegmentGhost,
  type SegmentSummary, type LeaderboardRow,
} from '@/api/hooks/useSegments';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { formatDurationClock, formatDateShort } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

const DASH = '—';

/* Racer accent colours — cyan for A, fuchsia for B — handed to Recharts as
   dynamic hex (graphics, not text). The matching Tailwind classes below keep
   the leaderboard chips and the chart legend on the same two hues. */
const COLOR_A = '#22d3ee'; // cyan-400
const COLOR_B = '#e879f9'; // fuchsia-400

/** Segment duration in whole seconds → m:ss clock. */
function clock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return DASH;
  return formatDurationClock(seconds * 1000);
}

/** Energy efficiency, already Wh/km from the API (a fixed unit). */
function whPerKm(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? DASH : `${fmtInt(v)} Wh/km`;
}

/** Signed seconds gap, e.g. "+4.2s" / "−1.1s" (minus is faster than the PR). */
function signedDelta(s: number): string {
  if (!Number.isFinite(s) || s === 0) return '—';
  const sign = s < 0 ? '−' : '+';
  return `${sign}${Math.abs(s).toFixed(1)}s`;
}

export default function SegmentsPage() {
  const { t } = useTranslation();
  usePageTitle(t('segments.title', 'Ghost Racing'));

  const { formatDistance } = useUnits();
  const { vehicleId } = useSelectedVehicle();
  const noVehicle = vehicleId === null;

  const segmentsQuery = useSegments(vehicleId);
  const {
    data: segmentsData, isLoading: segLoading, error: segError, refetch: refetchSegments,
  } = segmentsQuery;
  const segments = useMemo(() => segmentsData?.segments ?? [], [segmentsData]);

  /* ── Selection state ──
     A chosen segment drives the leaderboard; two chosen attempts (drive IDs)
     drive the ghost race. Picking a new segment clears the racers so a stale
     A/B from another segment never fires a ghost request. */
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);
  const [board, setBoard] = useState<'time' | 'efficiency'>('time');
  const [racerA, setRacerA] = useState<number | null>(null);
  const [racerB, setRacerB] = useState<number | null>(null);

  const onSelectSegment = useCallback((id: number) => {
    if (id <= 0) return; // id === 0 → persist failed, cannot drill in
    setSelectedSegmentId(id);
    setRacerA(null);
    setRacerB(null);
  }, []);

  const lbQuery = useSegmentLeaderboard(selectedSegmentId);
  const {
    data: leaderboard, isLoading: lbLoading, error: lbError, refetch: refetchLeaderboard,
  } = lbQuery;

  /* Default the two racers to the fastest run (the by-time PR) versus the
     runner-up so a ghost renders as soon as a segment is opened. Keyed on the
     leaderboard's own segment id so it defaults once per segment and never
     clobbers a manual pick afterwards. */
  const defaultedFor = useRef<number | null>(null);
  useEffect(() => {
    const segId = leaderboard?.segment.id ?? null;
    if (segId == null || defaultedFor.current === segId) return;
    const rows = leaderboard?.by_time ?? [];
    if (rows.length >= 2) {
      setRacerA(rows[0].drive_id);
      setRacerB(rows[1].drive_id);
    } else if (rows.length === 1) {
      setRacerA(rows[0].drive_id);
      setRacerB(null);
    }
    defaultedFor.current = segId;
  }, [leaderboard]);

  const pickA = useCallback((id: number) => {
    setRacerA((prev) => (prev === id ? null : id));
    setRacerB((prev) => (prev === id ? null : prev));
  }, []);
  const pickB = useCallback((id: number) => {
    setRacerB((prev) => (prev === id ? null : id));
    setRacerA((prev) => (prev === id ? null : prev));
  }, []);

  const ghostQuery = useSegmentGhost(selectedSegmentId, racerA, racerB);
  const {
    data: ghost, isLoading: ghostLoading, error: ghostError, refetch: refetchGhost,
  } = ghostQuery;

  const onRetrySegments = useCallback(() => { void refetchSegments(); }, [refetchSegments]);
  const onRetryLeaderboard = useCallback(() => { void refetchLeaderboard(); }, [refetchLeaderboard]);
  const onRetryGhost = useCallback(() => { void refetchGhost(); }, [refetchGhost]);

  const rows = board === 'time'
    ? leaderboard?.by_time ?? []
    : leaderboard?.by_efficiency ?? [];

  /* drive_id → its by-time row, for labelling the two racers by date. */
  const rowByDrive = useMemo(() => {
    const m = new Map<number, LeaderboardRow>();
    (leaderboard?.by_time ?? []).forEach((r) => m.set(r.drive_id, r));
    return m;
  }, [leaderboard]);

  const labelFor = useCallback((driveId: number | null): string => {
    if (driveId == null) return DASH;
    const r = rowByDrive.get(driveId);
    return r ? formatDateShort(r.started_at) : `#${driveId}`;
  }, [rowByDrive]);

  /* ── Ghost race chart data ──
     "Elapsed vs distance": both attempts on one seconds axis (unit-free); the
     lower line at any point of the route is ahead. Series can have different
     sample fractions, so fold them onto a shared 0.2%-fraction grid and let
     Recharts connect across the gaps. */
  const raceData = useMemo(() => {
    if (!ghost) return [] as Array<{ frac: number; a?: number; b?: number }>;
    const grid = new Map<number, { frac: number; a?: number; b?: number }>();
    const put = (f: number, key: 'a' | 'b', v: number) => {
      const k = Math.round(f * 500) / 500;
      const e = grid.get(k) ?? { frac: k };
      if (e[key] == null) e[key] = v;
      grid.set(k, e);
    };
    ghost.a.series.forEach((p) => put(p.fraction_of_distance, 'a', p.elapsed_s));
    ghost.b.series.forEach((p) => put(p.fraction_of_distance, 'b', p.elapsed_s));
    return [...grid.values()].sort((x, y) => x.frac - y.frac);
  }, [ghost]);

  /* "Time gap": the A-vs-B split at each shared fraction (delta_s < 0 → A ahead),
     already aligned by the backend. */
  const gapData = useMemo(
    () => (ghost?.split_deltas ?? []).map((s) => ({ frac: s.fraction, delta: s.delta_s })),
    [ghost],
  );

  const winnerLabel = useMemo(() => {
    if (!ghost) return null;
    if (ghost.winner_drive_id == null) return t('segments.ghost.tie', 'Dead heat');
    const side = ghost.winner_drive_id === racerA
      ? t('segments.ghost.racerA', 'Attempt A')
      : t('segments.ghost.racerB', 'Attempt B');
    return `${side} · ${labelFor(ghost.winner_drive_id)}`;
  }, [ghost, racerA, labelFor, t]);

  const pctTick = useCallback((f: number) => `${Math.round(f * 100)}%`, []);

  const selectVehicleMsg = t('segments.selectVehicle', 'Select a vehicle to find its route segments.');
  const bothChosen = racerA != null && racerB != null && racerA !== racerB;

  return (
    <PageContainer
      title={t('segments.title', 'Ghost Racing')}
      subtitle={t('segments.subtitle', 'Race your most-repeated routes against your own personal best')}
      actions={<VehicleSelect />}
      query={segmentsQuery}
    >
      {/* ── 1. Detected segments ─────────────────────────────────────────── */}
      <FadeIn>
        <section aria-label={t('segments.list.title', 'Route segments')}>
          <PanelTitle className="mb-3 flex items-center gap-2">
            <RouteIcon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('segments.list.title', 'Route Segments')}
          </PanelTitle>

          {noVehicle ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState /* no-action: selection-gated — a vehicle must be chosen first */
                icon={<RouteIcon className="h-8 w-8" />}
                message={selectVehicleMsg}
              />
            </GlassPanel>
          ) : segLoading && !segmentsData ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} height={168} className="rounded-xl" />
              ))}
            </div>
          ) : segError ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={segError} onRetry={onRetrySegments} />
            </GlassPanel>
          ) : segments.length === 0 ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState /* no-action: transient — segments appear once a route is driven twice */
                icon={<Flag className="h-8 w-8" />}
                message={t('segments.list.empty', 'No segments yet — drive the same start-to-end route twice and it becomes a raceable segment.')}
              />
            </GlassPanel>
          ) : (
            <div role="listbox" aria-label={t('segments.list.title', 'Route segments')} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {segments.map((s) => (
                <SegmentCard
                  key={s.id || `${s.name}-${s.start_address}`}
                  segment={s}
                  selected={selectedSegmentId === s.id && s.id > 0}
                  disabled={s.id <= 0}
                  onSelect={onSelectSegment}
                  formatDistance={formatDistance}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>
      </FadeIn>

      {/* ── 2. Leaderboard for the selected segment ──────────────────────── */}
      {selectedSegmentId != null ? (
        <FadeIn delay={0.05}>
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <PanelTitle className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-300" aria-hidden="true" />
                {leaderboard?.segment.name ?? t('segments.board.title', 'Leaderboard')}
              </PanelTitle>
              {/* by-time / by-efficiency toggle */}
              <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-0.5" role="group" aria-label={t('segments.board.orderBy', 'Order by')}>
                {(['time', 'efficiency'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setBoard(mode)}
                    aria-pressed={board === mode}
                    className={cn(
                      'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                      board === mode ? 'bg-[var(--surface-3)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                    )}
                  >
                    {mode === 'time'
                      ? t('segments.board.byTime', 'By time')
                      : t('segments.board.byEfficiency', 'By efficiency')}
                  </button>
                ))}
              </div>
            </div>

            {lbLoading && !leaderboard ? (
              <Skeleton height={240} className="rounded-xl" />
            ) : lbError ? (
              <QueryError error={lbError} onRetry={onRetryLeaderboard} />
            ) : rows.length === 0 ? (
              <EmptyState /* no-action: transient — a segment with no ranked attempts yet */
                icon={<Timer className="h-8 w-8" />}
                message={t('segments.board.empty', 'No ranked attempts on this segment yet.')}
              />
            ) : (
              <LeaderboardTable
                rows={rows}
                board={board}
                racerA={racerA}
                racerB={racerB}
                onPickA={pickA}
                onPickB={pickB}
                t={t}
              />
            )}
          </GlassPanel>
        </FadeIn>
      ) : null}

      {/* ── 3. Ghost race — head-to-head between the two chosen attempts ──── */}
      {selectedSegmentId != null ? (
        <FadeIn delay={0.1}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-1 flex items-center gap-2">
              <Swords className="h-4 w-4 text-fuchsia-300" aria-hidden="true" />
              {t('segments.ghost.title', 'Ghost Race')}
            </PanelTitle>
            <Text as="p" variant="caption" className="mb-4">
              {t('segments.ghost.subtitle', 'Pick two attempts above (A and B) to race them lap-over-lap on the same route.')}
            </Text>

            {!bothChosen ? (
              <EmptyState /* no-action: selection-gated — needs two distinct attempts */
                icon={<Swords className="h-8 w-8" />}
                message={t('segments.ghost.pick', 'Choose an A and a B attempt from the leaderboard to start the race.')}
              />
            ) : ghostLoading && !ghost ? (
              <Skeleton height={360} className="rounded-xl" />
            ) : ghostError ? (
              <QueryError error={ghostError} onRetry={onRetryGhost} />
            ) : ghost ? (
              <div className="flex flex-col gap-5">
                {/* Winner banner + the two attempts */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-neon-green/20 bg-neon-green/10 p-4 sm:col-span-1">
                    <Text as="p" variant="metricLabel" className="mb-1 flex items-center gap-1.5">
                      <Trophy className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                      {t('segments.ghost.winner', 'Winner')}
                    </Text>
                    <Text as="p" size="lg" weight="bold" className="text-emerald-300">
                      {winnerLabel}
                    </Text>
                    <Text as="p" variant="caption" className="mt-1">
                      {ghost.winner_drive_id == null
                        ? t('segments.ghost.tieHelp', 'Identical recorded times.')
                        : t('segments.ghost.margin', 'Won by {{margin}}', { margin: clock(ghost.margin_s) })}
                    </Text>
                  </div>
                  <RacerStat
                    color={COLOR_A}
                    label={t('segments.ghost.racerA', 'Attempt A')}
                    date={labelFor(racerA)}
                    time={clock(ghost.a.duration_s)}
                    lead={ghost.winner_drive_id === racerA}
                  />
                  <RacerStat
                    color={COLOR_B}
                    label={t('segments.ghost.racerB', 'Attempt B')}
                    date={labelFor(racerB)}
                    time={clock(ghost.b.duration_s)}
                    lead={ghost.winner_drive_id === racerB}
                  />
                </div>

                {/* Elapsed time vs distance — the lower line is ahead */}
                <div>
                  <Text as="p" variant="label" className="mb-2">
                    {t('segments.ghost.elapsed', 'Elapsed time along the route')}
                  </Text>
                  <div
                    role="img"
                    aria-label={t('segments.ghost.elapsedAria', 'Line chart of elapsed time versus distance for both attempts; the lower line is ahead')}
                    className="h-64 sm:h-72"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={raceData} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
                        {chartGrid}
                        <XAxis
                          dataKey="frac"
                          type="number"
                          domain={[0, 1]}
                          ticks={[0, 0.25, 0.5, 0.75, 1]}
                          tickFormatter={pctTick}
                          tick={axisTick}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          width={52}
                          tick={axisTick}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => clock(v)}
                        />
                        <Tooltip content={
                          <ChartTooltip
                            labelFormatter={(l) => pctTick(Number(l))}
                            valueFormatter={(v) => clock(Number(v))}
                          />
                        } />
                        <Line
                          type="monotone" dataKey="a" connectNulls
                          stroke={COLOR_A} strokeWidth={2} dot={false}
                          name={t('segments.ghost.racerA', 'Attempt A')}
                          animationDuration={700}
                        />
                        <Line
                          type="monotone" dataKey="b" connectNulls
                          stroke={COLOR_B} strokeWidth={2} dot={false}
                          name={t('segments.ghost.racerB', 'Attempt B')}
                          animationDuration={700}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Time gap — where A gained or lost against B */}
                {gapData.length > 0 ? (
                  <div>
                    <Text as="p" variant="label" className="mb-2">
                      {t('segments.ghost.gap', 'Time gap (A vs B)')}
                    </Text>
                    <div
                      role="img"
                      aria-label={t('segments.ghost.gapAria', 'Area chart of the A-versus-B time gap along the route; below the zero line means A is ahead')}
                      className="h-48 sm:h-56"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={gapData} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
                          <defs>
                            <ChartGradient id="segGapGrad" color={COLOR_A} opacity={0.3} />
                          </defs>
                          {chartGrid}
                          <XAxis
                            dataKey="frac"
                            type="number"
                            domain={[0, 1]}
                            ticks={[0, 0.25, 0.5, 0.75, 1]}
                            tickFormatter={pctTick}
                            tick={axisTick}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            width={52}
                            tick={axisTick}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) => signedDelta(v)}
                          />
                          <Tooltip content={
                            <ChartTooltip
                              labelFormatter={(l) => pctTick(Number(l))}
                              valueFormatter={(v) => signedDelta(Number(v))}
                            />
                          } />
                          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.7} />
                          <Area
                            type="monotone" dataKey="delta"
                            stroke={COLOR_A} strokeWidth={2}
                            fill="url(#segGapGrad)"
                            name={t('segments.ghost.gap', 'Time gap (A vs B)')}
                            isAnimationActive={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <Text as="p" variant="caption" className="mt-2">
                      {t('segments.ghost.gapHelp', 'Below the line, Attempt A is ahead; above it, Attempt B leads.')}
                    </Text>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState /* no-action: transient — no aligned series for this pair */
                icon={<Swords className="h-8 w-8" />}
                message={t('segments.ghost.noData', 'Not enough shared telemetry to align these two attempts.')}
              />
            )}
          </GlassPanel>
        </FadeIn>
      ) : null}
    </PageContainer>
  );
}

/* ── Segment summary card ─────────────────────────────────────────────── */

interface SegmentCardProps {
  segment: SegmentSummary;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: number) => void;
  formatDistance: (meters: number, options?: { precision?: number }) => string;
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string;
}

function SegmentCard({ segment: s, selected, disabled, onSelect, formatDistance, t }: SegmentCardProps) {
  return (
    <SelectableCard
      role="option"
      selected={selected}
      disabled={disabled}
      onClick={() => onSelect(s.id)}
      aria-label={t('segments.card.aria', 'Open leaderboard for {{name}}', { name: s.name })}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Flag className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
          <Text as="span" variant="subhead" weight="semibold" className="truncate">
            {s.name}
          </Text>
        </div>
        <StatusPill color="bg-cyan-400">
          {t('segments.card.attempts', '{{n}} runs', { n: s.attempt_count })}
        </StatusPill>
      </div>

      <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <Text as="span" variant="caption" className="truncate">
          {s.start_address} → {s.end_address}
        </Text>
      </div>

      <dl className="grid grid-cols-3 gap-2 pt-1">
        <div>
          <Text as="dt" variant="caption">{t('segments.card.distance', 'Distance')}</Text>
          <Text as="dd" variant="bodySm" weight="semibold" className="tabular-nums">
            {formatDistance(s.distance_m)}
          </Text>
        </div>
        <div>
          <Text as="dt" variant="caption" className="flex items-center gap-1">
            <Trophy className="h-3 w-3 text-amber-300" aria-hidden="true" />
            {t('segments.card.best', 'Best')}
          </Text>
          <Text as="dd" variant="bodySm" weight="semibold" className="tabular-nums text-amber-300">
            {clock(s.best_time?.duration_s)}
          </Text>
        </div>
        <div>
          <Text as="dt" variant="caption" className="flex items-center gap-1">
            <Zap className="h-3 w-3 text-emerald-300" aria-hidden="true" />
            {t('segments.card.eff', 'Best eff.')}
          </Text>
          <Text as="dd" variant="bodySm" weight="semibold" className="tabular-nums text-emerald-300">
            {whPerKm(s.best_efficiency?.wh_per_km)}
          </Text>
        </div>
      </dl>
    </SelectableCard>
  );
}

/* ── Leaderboard table ────────────────────────────────────────────────── */

interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  board: 'time' | 'efficiency';
  racerA: number | null;
  racerB: number | null;
  onPickA: (id: number) => void;
  onPickB: (id: number) => void;
  t: (key: string, fallback: string, opts?: Record<string, unknown>) => string;
}

function LeaderboardTable({ rows, board, racerA, racerB, onPickA, onPickB, t }: LeaderboardTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
            <th scope="col" className="py-2 pr-3 font-medium">#</th>
            <th scope="col" className="py-2 pr-3 font-medium">{t('segments.table.date', 'Date')}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{t('segments.table.time', 'Time')}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{t('segments.table.eff', 'Wh/km')}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{t('segments.table.delta', 'Δ to best')}</th>
            <th scope="col" className="py-2 text-right font-medium">{t('segments.table.race', 'Race')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isA = racerA === r.drive_id;
            const isB = racerB === r.drive_id;
            return (
              <tr
                key={r.drive_id}
                className={cn(
                  'border-b border-[var(--border-subtle)] transition-colors',
                  (isA || isB) && 'bg-[var(--surface-elevated)]',
                )}
              >
                <td className="py-2 pr-3 tabular-nums text-[var(--text-secondary)]">{r.rank}</td>
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-2">
                    {formatDateShort(r.started_at)}
                    {r.is_pr ? (
                      <StatusPill color="bg-amber-400">{t('segments.table.pr', 'PR')}</StatusPill>
                    ) : null}
                  </span>
                </td>
                <td className={cn('py-2 pr-3 text-right tabular-nums', board === 'time' && 'font-semibold text-[var(--text-primary)]')}>
                  {clock(r.duration_s)}
                </td>
                <td className={cn('py-2 pr-3 text-right tabular-nums', board === 'efficiency' && 'font-semibold text-[var(--text-primary)]')}>
                  {whPerKm(r.wh_per_km)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-[var(--text-muted)]">
                  {r.delta_to_best_s === 0 ? DASH : signedDelta(r.delta_to_best_s)}
                </td>
                <td className="py-2 text-right">
                  <div className="inline-flex gap-1">
                    <RaceButton active={isA} color="cyan" onClick={() => onPickA(r.drive_id)} label="A" />
                    <RaceButton active={isB} color="fuchsia" onClick={() => onPickB(r.drive_id)} label="B" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RaceButtonProps {
  active: boolean;
  color: 'cyan' | 'fuchsia';
  onClick: () => void;
  label: string;
}

function RaceButton({ active, color, onClick, label }: RaceButtonProps) {
  const on = color === 'cyan'
    ? 'bg-cyan-400/20 text-cyan-200 ring-1 ring-cyan-400/50'
    : 'bg-fuchsia-400/20 text-fuchsia-200 ring-1 ring-fuchsia-400/50';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}${active ? ' (selected)' : ''}`}
      className={cn(
        'h-7 w-7 rounded-md text-xs font-bold transition-colors',
        active ? on : 'bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
      )}
    >
      {label}
    </button>
  );
}

/* ── Racer summary tile in the ghost banner ───────────────────────────── */

interface RacerStatProps {
  color: string;
  label: string;
  date: string;
  time: string;
  lead: boolean;
}

function RacerStat({ color, label, date, time, lead }: RacerStatProps) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
          <Text as="span" variant="metricLabel">{label}</Text>
        </span>
        {lead ? <Gauge className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> : null}
      </div>
      <Text as="p" size="xl" weight="bold" className="tabular-nums" style={{ color }}>
        {time}
      </Text>
      <Text as="p" variant="caption" className="mt-1">{date}</Text>
    </div>
  );
}
