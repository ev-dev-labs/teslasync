import { Tooltip } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useTimeFormatPreference } from '@/hooks/useTimeFormatPreference';
import type { TzMode } from '@/lib/timezone';

export type TimeStampFormat = 'relative' | 'absolute' | 'auto';

export interface TimeStampProps {
  /** ISO string, epoch number, Date, or null/undefined. */
  value: string | number | Date | null | undefined;
  /**
   * Visible format. 'auto' (default) honors the user's
   * `time_format_default` Settings preference; explicit 'relative' or
   * 'absolute' overrides it for a specific surface.
   */
  format?: TimeStampFormat;
  /**
   * Optional timezone-display mode override. When unset the component
   * defaults to `settings.tz_display_default` ('vehicle' out of the
   * box). Passing `'utc'` is useful for forensic/audit surfaces that
   * must always render in UTC regardless of the user's preference.
   * Mirrors the `in` prop on `<DateTime>`.
   */
  in?: TzMode;
  className?: string;
}

/**
 * Shared timestamp renderer with a hover tooltip showing the alternate
 * format. The visible body picks relative ("2h ago") or absolute
 * ("Apr 4, 2:30 AM") based on the `format` prop, defaulting to the user's
 * global Settings preference. The tooltip always shows the OTHER format
 * so power users can flip between perspectives without leaving the page.
 *
 * Honors `settings.locale` and the resolved IANA timezone (defaults to
 * `settings.tz_display_default`, overridable via the `in` prop) when
 * formatting both the visible body and the tooltip alternate.
 *
 * Renders the universal "—" placeholder (no tooltip) when `value` is
 * null, undefined, or an unparseable timestamp. (Phase-45 / Prompt 22.)
 */
export function TimeStamp({ value, format = 'auto', in: mode, className }: TimeStampProps) {
  const pref = useTimeFormatPreference();
  const { formatDateTime, formatRelative } = useDateFormat(mode);

  if (value == null) {
    return <span className={className}>—</span>;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <span className={className}>—</span>;
  }

  const effective = format === 'auto' ? pref : format;
  const primary = effective === 'relative' ? formatRelative(date) : formatDateTime(date);
  const secondary = effective === 'relative' ? formatDateTime(date) : formatRelative(date);

  return (
    <Tooltip content={secondary}>
      <span className={className}>{primary}</span>
    </Tooltip>
  );
}
