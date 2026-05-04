import { Tooltip } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { useTimeFormatPreference } from '@/hooks/useTimeFormatPreference';

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
  className?: string;
}

/**
 * Shared timestamp renderer with a hover tooltip showing the alternate
 * format. The visible body picks relative ("2h ago") or absolute
 * ("Apr 4, 2:30 AM") based on the `format` prop, defaulting to the user's
 * global Settings preference. The tooltip always shows the OTHER format
 * so power users can flip between perspectives without leaving the page.
 *
 * Renders the universal "—" placeholder (no tooltip) when `value` is
 * null, undefined, or an unparseable timestamp. (Phase-45 / Prompt 22.)
 */
export function TimeStamp({ value, format = 'auto', className }: TimeStampProps) {
  const pref = useTimeFormatPreference();

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
