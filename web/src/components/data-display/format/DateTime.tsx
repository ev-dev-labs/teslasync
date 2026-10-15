import {
  formatDateTime,
  formatRelativeTime,
  formatDate,
  formatDateShort,
  formatTime,
  formatDayKey,
  tzAbbreviation,
  type FormatOptions,
} from '@/lib/dateFormat';
import { resolveLocale } from '@/lib/locale';
import { useSettings } from '@/hooks/useSettings';
import { useTimezone, type TzMode } from '@/lib/timezone';

export type DateTimeVariant = 'full' | 'date' | 'time' | 'relative' | 'short' | 'day';

interface DateTimeProps {
  value: string | Date | null | undefined;
  /** `day` formats a YYYY-MM-DD business date; other variants format instants. */
  variant?: DateTimeVariant;
  /**
   * Override which timezone the timestamp is rendered in. Ignored for `day`.
   * When unset
   * the component preserves its prior pure behavior (uses the browser's
   * locale + timezone) — this is the back-compat path used by hundreds
   * of call sites and unit tests that render outside Router/Query
   * providers.
   *
   * When set, the component subscribes to `useSelectedVehicle()` and
   * `useSettings()` to resolve the IANA name. See
   * `web/src/lib/timezone.ts` for the resolution rules.
   */
  in?: TzMode;
  /** Append the short tz abbreviation (e.g. "PST") for instants, never business days. */
  showTz?: boolean;
  /** Explicit clock precision uses the selected locale and default timezone mode. */
  clock?: FormatOptions['clock'];
  className?: string;
}

/**
 * Locale-aware datetime renderer that hovers the canonical ISO for instants
 * or the original calendar key for business days. The `day` variant reads
 * the selected locale but never resolves a timezone or displays a clock.
 * Wraps the pure helpers in `@/lib/dateFormat`.
 *
 * When `in`, `showTz`, or explicit `clock` options are set, renders via the
 * provider-aware variant `<DateTimeWithTz>`. The default no-prop path
 * stays pure to keep render cost low across table-heavy pages.
 */
export function DateTime(props: DateTimeProps) {
  if (props.variant === 'day') {
    return <BusinessDay {...props} />;
  }
  if (props.in !== undefined || props.showTz || props.clock !== undefined) {
    return <DateTimeWithTz {...props} />;
  }
  return <PureDateTime {...props} />;
}

function BusinessDay({ value, className }: DateTimeProps) {
  const { settings } = useSettings();
  const key = typeof value === 'string' ? value : undefined;
  const display = formatDayKey(key, { locale: resolveLocale(settings.locale) });
  return <span className={className} title={display === '—' ? undefined : key}>{display}</span>;
}

function PureDateTime({ value, variant = 'full', className }: DateTimeProps) {
  return renderSpan({ value, variant, className });
}

/**
 * Module-cached IANA timezone validity probe. `Intl.DateTimeFormat` throws a
 * `RangeError` when constructed with an unknown `timeZone`, and the shared
 * display formatters in `@/lib/dateFormat` (unlike `tzAbbreviation`/`ymdInTz`)
 * propagate that throw. Caching keeps the check O(1) after a zone is first
 * seen — this runs once per row on table-heavy pages.
 */
const TZ_VALIDITY = new Map<string, boolean>();
function isValidTimeZone(tz: string): boolean {
  const cached = TZ_VALIDITY.get(tz);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    ok = true;
  } catch {
    ok = false;
  }
  TZ_VALIDITY.set(tz, ok);
  return ok;
}

/**
 * Renders the timestamp in the IANA timezone resolved from the user's
 * settings + the active vehicle. Always calls `useTimezone` and
 * `useSettings` so React's hook rules are honored regardless of which
 * branch was taken on the previous render — this component is mounted
 * only when `in` / `showTz` / `clock` is set, so the render path is consistent
 * for the lifetime of any given DateTime instance.
 */
function DateTimeWithTz({ value, variant = 'full', in: mode, showTz, clock, className }: DateTimeProps) {
  const { settings } = useSettings();
  const effectiveMode = (mode ?? settings.tz_display_default ?? 'vehicle') as TzMode;
  const resolvedTz = useTimezone(effectiveMode);
  // A malformed IANA zone (e.g. a garbage `vehicle.timezone` that slipped past
  // resolveTimezone) makes the pure display formatters throw RangeError, which
  // would crash the whole panel. Degrade an invalid zone to UTC so the
  // timestamp still renders. Validity is cached, so this stays cheap per row.
  const tz = isValidTimeZone(resolvedTz) ? resolvedTz : 'UTC';
  const locale = resolveLocale(settings.locale);
  return renderSpan({ value, variant, className, opts: { tz, locale, clock }, showTz, tz });
}

interface RenderArgs {
  value: string | Date | null | undefined;
  variant: DateTimeVariant;
  className?: string;
  opts?: FormatOptions;
  showTz?: boolean;
  tz?: string;
}

function renderSpan({ value, variant, className, opts, showTz, tz }: RenderArgs) {
  let display: string;
  switch (variant) {
    case 'relative':
      display = formatRelativeTime(value, opts);
      break;
    case 'date':
      display = formatDate(value, opts);
      break;
    case 'time':
      display = formatTime(value, opts);
      break;
    case 'short':
      display = formatDateShort(value, opts);
      break;
    case 'full':
    default:
      display = formatDateTime(value, opts);
      break;
  }

  let title: string | undefined;
  if (value) {
    const d = value instanceof Date ? value : new Date(value);
    if (!isNaN(d.getTime())) {
      title = opts?.tz ? `${d.toISOString()} (${opts.tz})` : d.toISOString();
    }
  }

  const abbrev = showTz && tz && value ? tzAbbreviation(value, tz) : '';

  return (
    <span className={className} title={title}>
      {display}
      {abbrev && (
        <span className="ml-1 text-xs text-[var(--text-muted)]">{abbrev}</span>
      )}
    </span>
  );
}
