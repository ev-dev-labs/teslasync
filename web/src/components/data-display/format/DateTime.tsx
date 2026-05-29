import {
  formatDateTime,
  formatRelativeTime,
  formatDate,
  formatDateShort,
  formatTime,
  tzAbbreviation,
  type FormatOptions,
} from '@/lib/dateFormat';
import { resolveLocale } from '@/lib/locale';
import { useSettings } from '@/hooks/useSettings';
import { useTimezone, type TzMode } from '@/lib/timezone';

export type DateTimeVariant = 'full' | 'date' | 'time' | 'relative' | 'short';

interface DateTimeProps {
  value: string | Date | null | undefined;
  variant?: DateTimeVariant;
  /**
   * Override which timezone the timestamp is rendered in. When unset
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
  /** When true, append the short tz abbreviation (e.g. "PST") after the rendered value. */
  showTz?: boolean;
  className?: string;
}

/**
 * Locale-aware datetime renderer that hovers the canonical ISO string for
 * unambiguous timestamps. Wraps the pure helpers in `@/lib/dateFormat`.
 *
 * When `in` or `showTz` is set, renders via the
 * provider-aware variant `<DateTimeWithTz>`. The default no-prop path
 * stays pure to keep render cost low across table-heavy pages.
 */
export function DateTime(props: DateTimeProps) {
  if (props.in !== undefined || props.showTz) {
    return <DateTimeWithTz {...props} />;
  }
  return <PureDateTime {...props} />;
}

function PureDateTime({ value, variant = 'full', className }: DateTimeProps) {
  return renderSpan({ value, variant, className });
}

/**
 * Renders the timestamp in the IANA timezone resolved from the user's
 * settings + the active vehicle. Always calls `useTimezone` and
 * `useSettings` so React's hook rules are honored regardless of which
 * branch was taken on the previous render — this component is mounted
 * only when `in` / `showTz` is set, so the render path is consistent
 * for the lifetime of any given DateTime instance.
 */
function DateTimeWithTz({ value, variant = 'full', in: mode, showTz, className }: DateTimeProps) {
  const { settings } = useSettings();
  const effectiveMode = (mode ?? settings.tz_display_default ?? 'vehicle') as TzMode;
  const tz = useTimezone(effectiveMode);
  const locale = resolveLocale(settings.locale);
  return renderSpan({ value, variant, className, opts: { tz, locale }, showTz, tz });
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
