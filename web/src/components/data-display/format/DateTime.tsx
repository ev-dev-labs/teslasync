import { useContext } from 'react';
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
import { FormattedReading, type FormattedReadingOptions } from './FormattedReading';
import { WorkspaceDateFormatContext } from './WorkspaceDateFormatContext';

export type DateTimeVariant = 'full' | 'date' | 'time' | 'relative' | 'short' | 'day';

interface DateTimeProps extends FormattedReadingOptions {
  value: string | Date | null | undefined;
  /** `day` formats a YYYY-MM-DD business date; other variants format instants. */
  variant?: DateTimeVariant;
  /**
   * Override the saved display timezone mode. Ignored for `day`.
   */
  in?: TzMode;
  /** Explicit clock precision uses the selected locale and default timezone mode. */
  clock?: FormatOptions['clock'];
}

/**
 * Locale-aware datetime renderer. Each timestamp is shown once, formatted
 * in the resolved display zone — never with a raw ISO hover or a zone
 * abbreviation suffix. The `day` variant reads the selected locale but
 * never resolves a timezone or displays a clock. Wraps the pure helpers
 * in `@/lib/dateFormat`.
 *
 * The workspace resolves display preferences once, so ordinary timestamps
 * update with preferences without adding data subscriptions in each row.
 */
export function DateTime(props: DateTimeProps) {
  const options = useContext(WorkspaceDateFormatContext);
  if (props.variant === 'day') {
    return <BusinessDay {...props} />;
  }
  if (props.in !== undefined || (props.clock !== undefined && options === undefined)) {
    return <DateTimeWithTz {...props} />;
  }
  const { value, variant = 'full', label, className, clock } = props;
  return renderSpan({ value, variant, label, className, opts: clock ? { ...options, clock } : options });
}

function BusinessDay({ value, label, className }: DateTimeProps) {
  const { settings } = useSettings();
  const key = typeof value === 'string' ? value : undefined;
  const display = formatDayKey(key, { locale: resolveLocale(settings.locale) });
  return <FormattedReading label={label} className={className}>{display}</FormattedReading>;
}

function DateTimeWithTz({ value, variant = 'full', in: mode, clock, label, className }: DateTimeProps) {
  const { settings } = useSettings();
  const { tz: resolvedTz } = useDateFormat(mode);
  // A malformed IANA zone (e.g. a garbage `vehicle.timezone` that slipped past
  // resolveTimezone) degrades to UTC so the timestamp still renders in a
  // known zone. Validity is cached, so this stays cheap per row.
  const tz = isValidTimeZone(resolvedTz) ? resolvedTz : 'UTC';
  const locale = resolveLocale(settings.locale);
  return renderSpan({ value, variant, label, className, opts: { tz, locale, clock } });
}

interface RenderArgs extends FormattedReadingOptions {
  value: string | Date | null | undefined;
  variant: DateTimeVariant;
  opts?: FormatOptions;
}

function renderSpan({ value, variant, label, className, opts }: RenderArgs) {
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

  return <FormattedReading label={label} className={className}>{display}</FormattedReading>;
}
