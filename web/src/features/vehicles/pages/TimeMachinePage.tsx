import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery,
  Car,
  CircleDot,
  Clock,
  Gauge,
  Radio,
  Rewind,
  ShieldCheck,
  Thermometer,
  Zap,
} from 'lucide-react';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useTimeMachineRange,
  useTimeMachineState,
  type TimeMachineField,
} from '@/api/hooks/useTimeMachine';
import { PageLayout, Section, LayoutCard, SourceContent } from '@/components/layout';
import { Badge, Button, GlassPanel, Slider, Text } from '@/components/ui';
import { DateTime, StatStrip } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { fmtNumber, fmtScientificNumber } from '@/lib/numberFormat';
import { useDataState } from '@/hooks/useDataState';
import { StaleRefreshWarning } from '@/components/feedback';

// Minimal translate signature (subset of react-i18next's `t`) so the pure
// formatting helpers below can be unit-reasoned without the full TFunction
// generics. Mirrors the pattern used by <FreshnessIndicator>.
type TFn = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

// ── Categorisation ─────────────────────────────────────────────────────────
// signal_log carries proto Field names (BatteryLevel, InsideTemp, Gear, …).
// We bucket them into human categories by case-insensitive token match. The
// order matters: the first matcher wins, so the more specific tokens (tires)
// precede the broad ones (battery/motion). Anything unmatched falls to
// "other" — nothing is ever dropped.
type Category = 'battery' | 'climate' | 'motion' | 'tires' | 'security' | 'other';

const CATEGORY_ORDER: readonly Category[] = [
  'battery',
  'climate',
  'motion',
  'tires',
  'security',
  'other',
];

const CATEGORY_MATCHERS: ReadonlyArray<{ category: Category; pattern: RegExp }> = [
  { category: 'tires', pattern: /tpms|tire|tyre/i },
  { category: 'security', pattern: /lock|sentry|door|window|trunk|frunk|guard|alarm|occup|valet/i },
  { category: 'battery', pattern: /batter|charg|\bsoc\b|energy|kwh|voltage|amper|\brange\b|pack|module|cell/i },
  { category: 'climate', pattern: /climate|temperature|\btemp\b|hvac|\bfan\b|heater|cabin|defrost|seat|\bac\b/i },
  { category: 'motion', pattern: /speed|gear|odom|heading|steer|pedal|cruise|latitude|longitude|accel|brake|\brpm\b|throttle/i },
];

const CATEGORY_ICON: Record<Category, typeof Battery> = {
  battery: Battery,
  climate: Thermometer,
  motion: Gauge,
  tires: CircleDot,
  security: ShieldCheck,
  other: Radio,
};

const CATEGORY_ICON_CLASS: Record<Category, string> = {
  battery: 'text-emerald-300',
  climate: 'text-sky-300',
  motion: 'text-cyan-300',
  tires: 'text-amber-300',
  security: 'text-rose-300',
  other: 'text-violet-300',
};

export function categorize(field: string): Category {
  for (const matcher of CATEGORY_MATCHERS) {
    if (matcher.pattern.test(field)) return matcher.category;
  }
  return 'other';
}

/** Bucket + alphabetically sort fields, guaranteeing every category key exists. */
export function groupByCategory(fields: readonly TimeMachineField[]): Record<Category, TimeMachineField[]> {
  const grouped: Record<Category, TimeMachineField[]> = {
    battery: [],
    climate: [],
    motion: [],
    tires: [],
    security: [],
    other: [],
  };
  for (const f of fields) grouped[categorize(f.field)].push(f);
  for (const key of CATEGORY_ORDER) {
    grouped[key].sort((a, b) => a.field.localeCompare(b.field));
  }
  return grouped;
}

// ── Freshness / age ────────────────────────────────────────────────────────
// Age is how old a field's last change is RELATIVE TO THE SCRUB INSTANT (not
// wall-clock now), so scrubbing into the deep past still shows meaningful
// freshness. green < 2m, amber < 1h, red beyond ("very stale").
const AGE_FRESH_SECONDS = 120;
const AGE_STALE_SECONDS = 3600;

export function ageVariant(ageSeconds: number): 'success' | 'warning' | 'danger' {
  if (ageSeconds < AGE_FRESH_SECONDS) return 'success';
  if (ageSeconds < AGE_STALE_SECONDS) return 'warning';
  return 'danger';
}

export function formatDuration(seconds: number, t: TFn): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t('timeMachine.ageSeconds', '{{value}}s', { value: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('timeMachine.ageMinutes', '{{value}}m', { value: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('timeMachine.ageHours', '{{value}}h', { value: h });
  const d = Math.floor(h / 24);
  return t('timeMachine.ageDays', '{{value}}d', { value: d });
}

// ── Value rendering ────────────────────────────────────────────────────────
function formatFloat(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.abs(n) < 1 ? fmtScientificNumber(n, 4) : fmtNumber(n);
}

export function humanizeField(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function formatScalar(field: TimeMachineField, t: TFn): string {
  const v = field.value;
  if (typeof v === 'boolean') return v ? t('common.yes', 'Yes') : t('common.no', 'No');
  if (typeof v === 'number') return field.value_kind === 'float' ? formatFloat(v) : String(v);
  return String(v);
}

// ── Field row ──────────────────────────────────────────────────────────────
function FieldRow({ field }: { field: TimeMachineField }) {
  useNumberFormatting();
  const { t } = useTranslation();
  const isNull = field.value === null;

  return (
    <li className="flex items-center justify-between gap-3 border-b border-[var(--glass-border)] py-2 last:border-b-0">
      <div className="min-w-0">
        <Text as="p" weight="medium" className="break-words">
          {humanizeField(field.field)}
        </Text>
        <Text as="p" variant="caption" className="break-all font-mono">
          {field.field}
        </Text>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-end">
        <span className="tabular-nums text-sm text-[var(--text-primary)]">
          {isNull ? (
            <span className="text-[var(--text-muted)]">—</span>
          ) : field.value_kind === 'time' && typeof field.value === 'string' ? (
            <DateTime value={field.value} variant="short" />
          ) : (
            formatScalar(field, t)
          )}
        </span>
        <Badge
          variant={ageVariant(field.age_seconds)}
          size="sm"
          title={t('timeMachine.changedAgo', 'changed {{age}} ago', {
            age: formatDuration(field.age_seconds, t),
          })}
        >
          {formatDuration(field.age_seconds, t)}
        </Badge>
      </div>
    </li>
  );
}

// ── Category card (owns its own loading / error / empty state) ──────────────
interface CategoryCardProps {
  category: Category;
  fields: TimeMachineField[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

function CategoryCard({ category, fields, isLoading, isError, error, onRetry }: CategoryCardProps) {
  const { t } = useTranslation();
  const Icon = CATEGORY_ICON[category];
  const title = t(`timeMachine.category.${category}`, category);

  return (
    <LayoutCard title={title} actions={
      !isLoading && !isError ? <Badge variant="neutral" size="sm">{fields.length}</Badge> : undefined
    }>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${CATEGORY_ICON_CLASS[category]}`} aria-hidden="true" />
      </div>
      <SourceContent
        state={isLoading ? 'loading' : isError ? 'error' : fields.length === 0 ? 'empty' : 'ready'}
        label={title}
        emptyMessage={t('timeMachine.emptyCategory', 'No {{category}} signals at this instant', { category: title.toLowerCase() })}
        errorMessage={t('timeMachine.sourceError', 'Signal reconstruction could not be loaded.')}
        error={error}
        errorRecovery={{ onRetry }}
        loadingContent={<Skeleton lines={4} height={18} />}
        emptyContent={<EmptyState
          icon={<Icon className="h-6 w-6" aria-hidden="true" />}
          message={t('timeMachine.emptyCategory', 'No {{category}} signals at this instant', {
            category: title.toLowerCase(),
          })}
        />}
      >
        <ul className="flex flex-col">
          {fields.map((f) => (
            <FieldRow key={f.field} field={f} />
          ))}
        </ul>
      </SourceContent>
    </LayoutCard>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const SCRUB_DEBOUNCE_MS = 200;

export default function TimeMachinePage() {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  usePageTitle(t('timeMachine.title', 'Vehicle time machine'));

  const { vehicle } = useSelectedVehicle();
  const { isLoading: vehiclesLoading } = useVehicles();
  const vehicleId = vehicle?.id ?? null;

  const rangeQ = useTimeMachineRange(vehicleId);
  const rangeState = useDataState(rangeQ, { provenance: 'historical' });
  const range = rangeQ.data ?? null;

  // Parse the scrubber bounds once. Null whenever the vehicle has no usable
  // history (missing / unparseable / inverted range) — every downstream
  // calculation guards on this instead of scattering NaN checks.
  const bounds = useMemo(() => {
    if (!range?.earliest || !range?.latest) return null;
    const earliestMs = Date.parse(range.earliest);
    const latestMs = Date.parse(range.latest);
    if (!Number.isFinite(earliestMs) || !Number.isFinite(latestMs) || latestMs < earliestMs) {
      return null;
    }
    return { earliestMs, latestMs, span: Math.max(0, latestMs - earliestMs) };
  }, [range?.earliest, range?.latest]);

  // Immediate scrub instant (drives the display); a debounced copy drives the
  // query so dragging the slider doesn't fire a request per pixel.
  const [atMs, setAtMs] = useState<number | null>(null);
  const [debouncedAtMs, setDebouncedAtMs] = useState<number | null>(null);

  // Snap to the newest instant once history bounds arrive.
  useEffect(() => {
    if (bounds && atMs === null) setAtMs(bounds.latestMs);
  }, [bounds, atMs]);

  // Reset when the vehicle (and therefore its history) changes.
  useEffect(() => {
    setAtMs(null);
    setDebouncedAtMs(null);
  }, [vehicleId]);

  useEffect(() => {
    if (atMs === null) return;
    const id = window.setTimeout(() => setDebouncedAtMs(atMs), SCRUB_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [atMs]);

  const atISO = useMemo(
    () => (debouncedAtMs !== null ? new Date(debouncedAtMs).toISOString() : null),
    [debouncedAtMs],
  );
  const displayISO = useMemo(
    () => (atMs !== null ? new Date(atMs).toISOString() : null),
    [atMs],
  );

  const stateQ = useTimeMachineState(vehicleId, atISO);
  const stateState = useDataState(stateQ, { provenance: 'historical' });
  const fields = useMemo(() => stateQ.data?.fields ?? [], [stateQ.data]);
  const grouped = useMemo(() => groupByCategory(fields), [fields]);

  // Treat "history exists but we're still resolving the first instant" as
  // loading so category cards show skeletons rather than a false "empty".
  const reconstructing = stateQ.isLoading || (bounds !== null && atISO === null);

  // Normalised slider position (0..1) across [earliest, latest].
  const pos = useMemo(() => {
    if (!bounds || atMs === null || bounds.span === 0) return 1;
    return Math.min(1, Math.max(0, (atMs - bounds.earliestMs) / bounds.span));
  }, [bounds, atMs]);

  const onScrub = useCallback(
    (p: number) => {
      if (!bounds) return;
      const next = bounds.span > 0 ? bounds.earliestMs + p * bounds.span : bounds.latestMs;
      setAtMs(Math.round(next));
    },
    [bounds],
  );

  // deltaMs === null ⇒ jump to the newest instant ("Now").
  const jump = useCallback(
    (deltaMs: number | null) => {
      if (!bounds) return;
      const target = deltaMs === null ? bounds.latestMs : bounds.latestMs - deltaMs;
      setAtMs(Math.min(bounds.latestMs, Math.max(bounds.earliestMs, target)));
    },
    [bounds],
  );

  const formatSliderValue = useCallback(
    (p: number) => {
      if (!bounds) return '';
      const ms = bounds.span > 0 ? bounds.earliestMs + p * bounds.span : bounds.latestMs;
      return formatDateTime(new Date(ms).toISOString());
    },
    [bounds, formatDateTime],
  );

  const freshnessQueries = vehicleId !== null ? [rangeQ, stateQ] : undefined;

  const viewingAtLabel = displayISO ? formatDateTime(displayISO) : '—';
  const signalCount = stateQ.data == null ? null : stateQ.data.count ?? fields.length;
  const spanLabel = bounds ? formatDuration(bounds.span / 1000, t) : '—';

  return (
    <PageLayout
      title={t('timeMachine.title', 'Vehicle time machine')}
      subtitle={t('timeMachine.subtitle', "Scrub the DVR of your car's mind — reconstruct every signal at any past instant")}
      loading={vehiclesLoading}
      query={freshnessQueries}
    >
      {!vehicle && !vehiclesLoading ? (
        <GlassPanel className="p-8">
          {/* no-action: prerequisite empty state — no vehicle to time-travel. */}
          <EmptyState
            icon={<Car className="h-8 w-8" aria-hidden="true" />}
            message={t('timeMachine.noVehicles', 'No vehicles found. Add a vehicle to travel through its signal history.')}
          />
        </GlassPanel>
      ) : (
        <div className="space-y-6">
          <StaleRefreshWarning state={rangeState} label={t('timeMachine.timeline', 'Timeline')} />
          <StaleRefreshWarning state={stateState} label={t('timeMachine.signalState', 'Reconstructed signal state')} />
          {/* 1 — Timeline scrubber */}
          <FadeIn>
            <Section id="tm-scrubber-heading" title={t('timeMachine.timeline', 'Timeline')}>
              <LayoutCard title={t('timeMachine.scrubberLabel', 'Reconstruction instant')} actions={
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="ghost" size="sm" disabled={!bounds} onClick={() => jump(HOUR_MS)}>
                      {t('timeMachine.presetHour', '−1h')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={!bounds} onClick={() => jump(DAY_MS)}>
                      {t('timeMachine.presetDay', '−1d')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={!bounds} onClick={() => jump(WEEK_MS)}>
                      {t('timeMachine.presetWeek', '−1w')}
                    </Button>
                    <Button type="button" variant="secondary" size="sm" disabled={!bounds} onClick={() => jump(null)}>
                      <Zap className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      {t('timeMachine.now', 'Now')}
                    </Button>
                  </div>
              }>

                {rangeQ.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton width="60%" height={28} />
                    <Skeleton height={12} rounded />
                  </div>
                ) : rangeState.fatalError ? (
                  <QueryError error={rangeState.fatalError} onRetry={() => rangeQ.refetch()} />
                ) : !bounds ? (
                  // no-action: transient — this resolves automatically once Fleet Telemetry streams the vehicle's first signals; there is nothing to trigger from here.
                  <EmptyState
                    icon={<Rewind className="h-8 w-8" aria-hidden="true" />}
                    title={t('timeMachine.noHistory', 'No signal history')}
                    message={t('timeMachine.noHistoryHint', 'This vehicle has no recorded signals yet. History appears once telemetry starts flowing.')}
                  />
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-baseline gap-3">
                      <Clock className="h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
                      <DateTime
                        value={displayISO}
                        variant="full"
                        className="text-xl font-semibold text-[var(--text-primary)] sm:text-2xl"
                      />
                    </div>
                    <Slider
                      label={t('timeMachine.scrubberLabel', 'Reconstruction instant')}
                      showLabel={false}
                      min={0}
                      max={1}
                      step={0.0005}
                      value={pos}
                      onChange={onScrub}
                      formatValue={formatSliderValue}
                    />
                    <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <span className="inline-flex items-center gap-1">
                        <span>{t('timeMachine.earliest', 'Earliest')}:</span>
                        <DateTime value={range?.earliest ?? null} variant="short" />
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span>{t('timeMachine.latest', 'Latest')}:</span>
                        <DateTime value={range?.latest ?? null} variant="short" />
                      </span>
                    </div>
                  </div>
                )}
              </LayoutCard>
            </Section>
          </FadeIn>

          {/* 2 — KPI band */}
          <FadeIn delay={0.05}>
            <section
              aria-label={t('timeMachine.overview', 'Overview')}
            >
              <StatStrip id="time-machine-summary"
                period={{ kind: 'snapshot', label: t('timeMachine.summary', 'Reconstruction summary'), observedAt: stateQ.data?.at ?? null,
                  provenance: t('timeMachine.summarySource', 'Historical signal reconstruction') }}
                metrics={[
                  { metricId: 'text', occurrenceId: 'viewing-at', label: t('timeMachine.viewingAt', 'Viewing at'),
                    rawValue: displayISO ? viewingAtLabel : null },
                  { metricId: 'count', occurrenceId: 'signals', label: t('timeMachine.signalsReconstructed', 'Signals reconstructed'),
                    rawValue: reconstructing ? null : signalCount },
                  { metricId: 'count', occurrenceId: 'fields', label: t('timeMachine.fieldsTracked', 'Fields tracked'),
                    rawValue: range?.field_count ?? null },
                  { metricId: 'text', occurrenceId: 'history-span', label: t('timeMachine.dataSpan', 'History span'),
                    rawValue: bounds ? spanLabel : null },
                ]}
              />
            </section>
          </FadeIn>

          {/* 3 — Reconstructed signal state, grouped by category */}
          <FadeIn delay={0.1}>
            <Section id="tm-signals-heading" title={t('timeMachine.signalState', 'Reconstructed signal state')}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-5">
                {CATEGORY_ORDER.map((category) => (
                  <CategoryCard
                    key={category}
                    category={category}
                    fields={grouped[category]}
                    isLoading={reconstructing}
                    isError={stateState.fatalError != null}
                    error={stateState.fatalError}
                    onRetry={() => stateQ.refetch()}
                  />
                ))}
              </div>
            </Section>
          </FadeIn>
        </div>
      )}
    </PageLayout>
  );
}
