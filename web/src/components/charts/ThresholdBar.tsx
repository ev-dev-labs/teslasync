import { forwardRef, useMemo } from 'react';
import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/Typography';
import { fmtNumber, getGlobalPrecision } from '@/lib/numberFormat';

export interface ThresholdBand {
  /** Band start, in the same units as `value`. */
  from: number;
  /** Band end, in the same units as `value`. */
  to: number;
  /** Fill colour for the band segment. */
  color: string;
  /** Optional short name, surfaced to assistive tech and the active caption. */
  label?: string;
}

export interface ThresholdBarProps {
  value: number;
  /**
   * Domain floor — the lowest value worth showing, NOT necessarily zero.
   * Tyre pressure is meaningless below ~20 psi and a mounted tyre never
   * reaches 0, so anchoring the domain at 0 would spend most of the track on
   * states that cannot occur.
   */
  min: number;
  /** Domain ceiling — the highest value worth showing. */
  max: number;
  /**
   * Qualitative regions of the domain, e.g. critical / low / normal / high.
   * Rendered as a segmented track so the reader can see what "good" means
   * without knowing the numbers by heart.
   */
  bands?: ThresholdBand[];
  /** Optional reference value (target / manufacturer spec) drawn as a tick. */
  target?: number;
  label: string;
  unit?: string;
  decimals?: number;
  /**
   * Authoritative name for the reading's qualitative state.
   *
   * Supply this whenever the caller already owns a status predicate. Inferring
   * the state from `bands` has to assume an interval-closure convention at
   * shared edges, and real predicates are rarely symmetric (`v < LOW` on one
   * side, `v > HIGH` on the other). A reading landing exactly on a threshold
   * would then be named differently by the bar than by the caller's own status
   * text. Passing it explicitly removes the guess.
   */
  statusLabel?: string;
  /** Hide the numeric min/max end captions (useful in dense grids). */
  hideScale?: boolean;
  className?: string;
}

const toFinite = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * A value shown against the thresholds that give it meaning.
 *
 * A radial ring implies "proportion of a whole", which only reads correctly
 * when 100% is a real, recognisable state — a full battery, a complete score.
 * Most physical readings have no such whole: a tyre at "100%" of an arbitrary
 * 72.5 psi ceiling is destroyed, not full. Worse, when the ceiling is derived
 * from the value itself (`max={value * 1.5}`) the arc is mathematically
 * constant and conveys nothing at all.
 *
 * This renders the domain that actually matters, splits it into qualitative
 * bands, and marks where the reading falls. The question it answers is "am I
 * in the safe range, and how close to the edge?" rather than "what fraction of
 * an arbitrary maximum is this?". Instances sharing a domain stack into a
 * directly comparable column.
 *
 * Use {@link LinearGauge} only when 100% is genuinely meaningful, and
 * {@link BipolarBar} when the sign of the value carries information.
 */
export const ThresholdBar = forwardRef<HTMLDivElement, ThresholdBarProps>(
  function ThresholdBar(
    { value, min, max, bands, target, label, unit, decimals, statusLabel, hideScale, className },
    ref,
  ) {
    // Null-safety: callers forward optional API values that can be undefined /
    // null / NaN at runtime despite the `number` type. Sanitising here keeps
    // the geometry finite rather than emitting `left: NaN%`.
    const lo = toFinite(min);
    const hiRaw = toFinite(max);
    const hi = hiRaw > lo ? hiRaw : lo + 1;
    const span = hi - lo;

    const raw = toFinite(value);
    const clamped = Math.max(lo, Math.min(raw, hi));
    const pct = ((clamped - lo) / span) * 100;

    const segments = useMemo(
      () =>
        (bands ?? [])
          .map((b) => {
            const from = Math.max(lo, Math.min(toFinite(b.from), hi));
            const to = Math.max(lo, Math.min(toFinite(b.to), hi));
            return {
              ...b,
              leftPct: ((Math.min(from, to) - lo) / span) * 100,
              widthPct: (Math.abs(to - from) / span) * 100,
            };
          })
          .filter((b) => b.widthPct > 0),
      [bands, lo, hi, span],
    );

    // The band the reading currently sits in — named in the caption so the
    // colour is never the only carrier of meaning (WCAG 1.4.1).
    //
    // Bands are half-open `[from, to)` so a reading sitting exactly on a
    // boundary belongs to the band it is entering, not the one it just left —
    // this matches how threshold predicates are conventionally written
    // (`if (v < LOW) …`). The inclusive pass is the fallback for a reading at
    // the very top edge of the topmost band, which no half-open range covers.
    const activeBand = useMemo(() => {
      const list = bands ?? [];
      const within = (b: ThresholdBand, inclusiveHi: boolean) => {
        const bLo = Math.min(b.from, b.to);
        const bHi = Math.max(b.from, b.to);
        return clamped >= bLo && (inclusiveHi ? clamped <= bHi : clamped < bHi);
      };
      return list.find((b) => within(b, false)) ?? list.find((b) => within(b, true));
    }, [bands, clamped]);

    // An explicit status always wins over the inferred band name.
    const stateLabel = statusLabel ?? activeBand?.label;

    const d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision());
    const display = fmtNumber(clamped, d);
    const targetPct =
      target != null && Number.isFinite(target)
        ? ((Math.max(lo, Math.min(target, hi)) - lo) / span) * 100
        : null;

    return (
      <div
        ref={ref}
        role="meter"
        aria-label={label || undefined}
        aria-valuenow={clamped}
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuetext={
          stateLabel
            ? `${display}${unit ?? ''} — ${stateLabel}`
            : `${display}${unit ?? ''}`
        }
        className={cn('flex w-full flex-col gap-1.5', className)}
      >
        <div className="flex items-baseline justify-between gap-2">
          <Text as="span" size="xs" weight="medium" color="muted">
            {label}
          </Text>
          <Text as="span" size="lg" weight="bold" color="primary">
            {display}
            {unit && (
              <Text as="span" size="xs" weight="regular" color="muted">
                {unit}
              </Text>
            )}
          </Text>
        </div>

        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          {segments.map((b, i) => (
            <div
              key={`${b.from}-${b.to}-${i}`}
              aria-hidden="true"
              className="absolute inset-y-0"
              style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%`, background: b.color }}
            />
          ))}
          {targetPct != null && (
            <div
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-[var(--border-strong)]"
              style={{ left: `${targetPct}%` }}
            />
          )}
        </div>

        {/* The reading itself: a marker on the track, not a fill of it. */}
        <div className="relative h-3">
          <div
            aria-hidden="true"
            className="absolute top-0 h-3 w-1 -translate-x-1/2 rounded-full bg-[var(--text-primary)] ring-2 ring-[var(--surface-1)] transition-all duration-slow"
            style={{ left: `${pct}%` }}
          />
        </div>

        {!hideScale && (
          <div className="flex items-center justify-between">
            <Text as="span" size="xs" color="muted">
              {fmtNumber(lo, 0)}
              {unit}
            </Text>
            {stateLabel && (
              <Text as="span" size="xs" weight="medium" color="secondary">
                {stateLabel}
              </Text>
            )}
            <Text as="span" size="xs" color="muted">
              {fmtNumber(hi, 0)}
              {unit}
            </Text>
          </div>
        )}
      </div>
    );
  },
);
