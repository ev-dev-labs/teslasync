import {
  formatDateTime,
  formatRelativeTime,
  formatDate,
  formatDateShort,
  formatTime,
  formatDayKey,
  isValidTimeZone,
  type FormatOptions,
} from '@/lib/dateFormat';
import { resolveLocale } from '@/lib/locale';
import { useSettings } from '@/hooks/useSettings';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { TzMode } from '@/lib/timezone';

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
  /** Explicit clock precision uses the selected locale and default timezone mode. */
  clock?: FormatOptions['clock'];
  className?: string;
}

/**
 * Locale-aware datetime renderer. Each timestamp is shown once, formatted
 * in the resolved display zone — never with a raw ISO hover or a zone
 * abbreviation suffix. The `day` variant reads the selected locale but
 * never resolves a timezone or displays a clock. Wraps the pure helpers
 * in `@/lib/dateFormat`.
 *
 * When `in` or explicit `clock` options are set, renders via the
 * provider-aware variant `<DateTimeWithTz>`. The default no-prop path
 * stays pure to keep render cost low across table-heavy pages.
 */
export function DateTime(props: DateTimeProps) {
  if (props.variant === 'day') {
    return <BusinessDay {...props} />;
  }
  if (props.in !== undefined || props.clock !== undefined) {
    return <DateTimeWithTz {...props} />;
  }
  return <PureDateTime {...props} />;
}

function BusinessDay({ value, className }: DateTimeProps) {
  const { settings } = useSettings();
  const key = typeof value === 'string' ? value : undefined;
  const display = formatDayKey(key, { locale: resolveLocale(settings.locale) });
  return <span className={className}>{display}</span>;
}

function PureDateTime({ value, variant = 'full', className }: DateTimeProps) {
  return renderSpan({ value, variant, className });
}


/**
 * Renders the timestamp in the IANA timezone resolved from the user's
 * settings + the active vehicle. Always calls `useDateFormat` and
 * `useSettings` so React's hook rules are honored regardless of which
 * branch was taken on the previous render — this component is mounted
 * only when `in` / `showTz` / `clock` is set, so the render path is consistent
 * for the lifetime of any given DateTime instance.
 */
function DateTimeWithTz({ value, variant = 'full', in: mode, clock, className }: DateTimeProps) {
  const { settings } = useSettings();
  const { tz: resolvedTz } = useDateFormat(mode);
  // A malformed IANA zone (e.g. a garbage `vehicle.timezone` that slipped past
  // resolveTimezone) degrades to UTC so the timestamp still renders in a
  // known zone. Validity is cached, so this stays cheap per row.
  const tz = isValidTimeZone(resolvedTz) ? resolvedTz : 'UTC';
  const locale = resolveLocale(settings.locale);
  return renderSpan({ value, variant, className, opts: { tz, locale, clock } });
}

interface RenderArgs {
  value: string | Date | null | undefined;
  variant: DateTimeVariant;
  className?: string;
  opts?: FormatOptions;
}

function renderSpan({ value, variant, className, opts }: RenderArgs) {
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

  return <span className={className}>{display}</span>;
}
