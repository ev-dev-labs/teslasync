// Native parity port of web/src/components/data-display/TimeStamp.tsx.
// The web source composes four modules that have no native-parity surface:
//   - `useTimeFormatPreference` (reads `time_format_default` from settings),
//   - `useDateFormat` (locale + IANA-timezone-aware `formatDateTime` /
//     `formatRelative` formatters, themselves built on `@/lib/dateFormat`),
//   - `TzMode` from `@/lib/timezone`,
//   - the `<Tooltip>` UI primitive from `@/components/ui`.
// To keep behaviour faithful without those modules:
//   - The format preference is resolved from the native `useSettings`
//     web-parity hook (`time_format_default`, defaulting to 'relative'),
//     mirroring the web `useTimeFormatPreference` exactly.
//   - The timezone resolver (`resolveTimezone` / `browserTimezone`) and the
//     `formatDateTime` / `formatDate` / `formatRelative` helpers are inlined
//     verbatim from `@/lib/timezone` and `@/lib/dateFormat`. The web
//     `useDateFormat` sources the vehicle's IANA zone from `useSelectedVehicle`;
//     the native parity surface has no selected-vehicle hook, so the 'vehicle'
//     mode falls back to the user/browser zone — identical to the web fallback
//     when a vehicle has not been polled yet.
//   - The `<Tooltip content={secondary}>` (the alternate format) becomes
//     `accessibilityHint` on the `AppText` — the native analog used by the
//     sibling `Duration` / `Speed` ports for the web `title`/tooltip affordance.
// The web `<span className=…>` becomes an `AppText`; `className` is retained on
// the props for source compatibility but ignored on native, and `style` /
// `testID` are added for native parity consumers. The "—" placeholder renders
// without an `accessibilityHint`, matching the web's tooltip-less placeholder.

import React from 'react';
import { type StyleProp, type TextStyle } from 'react-native';

import { AppText } from '../../../components/ui/AppText';
import { useSettings } from '../../api/hooks/useSettings';

/** Universal placeholder rendered for null/undefined/unparseable timestamps. */
const FALLBACK = '—';

/**
 * Time-zone display modes for rendering timestamps in vehicle, browser, or UTC
 * time while the underlying data stays in UTC. Inlined from `@/lib/timezone`.
 */
export type TzMode = 'vehicle' | 'user' | 'utc';

/** Resolves the host's IANA timezone, or 'UTC' if `Intl` is unavailable. */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Pure IANA-timezone resolver mirroring `@/lib/timezone` `resolveTimezone`.
 * `'utc'` ⇒ 'UTC'; `'user'` ⇒ override or browser zone; `'vehicle'` ⇒ the
 * vehicle zone, falling back to the user zone when unset or 'UTC'.
 */
function resolveTimezone(
  mode: TzMode,
  vehicleTz?: string | null,
  userOverride?: string | null,
): string {
  if (mode === 'utc') return 'UTC';
  const userTz =
    userOverride && userOverride.trim() ? userOverride : browserTimezone();
  if (mode === 'user') return userTz;
  if (!vehicleTz || vehicleTz === 'UTC') return userTz;
  return vehicleTz;
}

/** Optional locale + timezone overrides for the shared formatters. */
interface FormatOptions {
  /** IANA timezone name, e.g. 'America/Los_Angeles'. Defaults to host. */
  tz?: string;
  /** BCP-47 locale, e.g. 'en-US'. Defaults to host locale. */
  locale?: string;
}

function intlOpts(
  base: Intl.DateTimeFormatOptions,
  opts?: FormatOptions,
): Intl.DateTimeFormatOptions {
  if (opts?.tz) {
    return { ...base, timeZone: opts.tz };
  }
  return base;
}

function intlLocale(opts?: FormatOptions): string | undefined {
  const raw = opts?.locale;
  // Empty / whitespace-only locale tags throw `RangeError` in `Intl.*`; treat
  // them as "no override" so the runtime falls back to the host locale.
  if (typeof raw === 'string' && raw.trim().length > 0) return raw;
  return undefined;
}

/** Full date + time: "Apr 4, 2026, 2:30 AM". Inlined from `@/lib/dateFormat`. */
function formatDateTime(
  value: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!value) return FALLBACK;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return FALLBACK;
  return d.toLocaleString(
    intlLocale(opts),
    intlOpts(
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      opts,
    ),
  );
}

/** Date only: "Apr 4, 2026" — the `formatRelative` past-7-day fallback target. */
function formatDate(
  value: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!value) return FALLBACK;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return FALLBACK;
  return d.toLocaleDateString(
    intlLocale(opts),
    intlOpts({ year: 'numeric', month: 'short', day: 'numeric' }, opts),
  );
}

/** Relative time: "just now", "3m ago", … then `formatDate` past 7 days. */
function formatRelative(
  value: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!value) return FALLBACK;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return FALLBACK;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value, opts);
}

/**
 * Returns the user's globally preferred default format for `<TimeStamp>`, read
 * from `time_format_default` via the native `useSettings` hook. Falls back to
 * 'relative' when settings have not loaded or the value is unknown — mirroring
 * the web `useTimeFormatPreference`.
 */
function useTimeFormatPreference(): 'relative' | 'absolute' {
  const { data } = useSettings();
  return data?.time_format_default === 'absolute' ? 'absolute' : 'relative';
}

export type TimeStampFormat = 'relative' | 'absolute' | 'auto';

export interface TimeStampProps {
  /** ISO string, epoch number, Date, or null/undefined. */
  value: string | number | Date | null | undefined;
  /**
   * Visible format. 'auto' (default) honors the user's `time_format_default`
   * Settings preference; explicit 'relative' or 'absolute' overrides it for a
   * specific surface.
   */
  format?: TimeStampFormat;
  /**
   * Optional timezone-display mode override. When unset the component defaults
   * to `settings.tz_display_default` ('vehicle' out of the box). Passing 'utc'
   * is useful for forensic/audit surfaces that must always render in UTC
   * regardless of the user's preference. Mirrors the `in` prop on `<DateTime>`.
   */
  in?: TzMode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Shared timestamp renderer. The visible body picks relative ("2h ago") or
 * absolute ("Apr 4, 2:30 AM") based on the `format` prop, defaulting to the
 * user's global Settings preference. The OTHER format is surfaced through
 * `accessibilityHint` (the native analog of the web hover tooltip) so power
 * users can still reach both perspectives.
 *
 * Honors `settings.locale` and the resolved IANA timezone (defaults to
 * `settings.tz_display_default`, overridable via the `in` prop) when formatting
 * both the visible body and the alternate hint.
 *
 * Renders the universal "—" placeholder (no hint) when `value` is null,
 * undefined, or an unparseable timestamp.
 */
export function TimeStamp({
  value,
  format = 'auto',
  in: mode,
  className: _className,
  style,
  testID,
}: TimeStampProps) {
  const pref = useTimeFormatPreference();
  const { data: settings } = useSettings();

  const effectiveMode: TzMode =
    mode ?? settings?.tz_display_default ?? 'vehicle';
  const opts: FormatOptions = {
    locale: settings?.locale,
    tz: resolveTimezone(effectiveMode, undefined, settings?.timezone_user),
  };

  if (value == null) {
    return (
      <AppText style={style} testID={testID}>
        {FALLBACK}
      </AppText>
    );
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return (
      <AppText style={style} testID={testID}>
        {FALLBACK}
      </AppText>
    );
  }

  const effective = format === 'auto' ? pref : format;
  const primary =
    effective === 'relative'
      ? formatRelative(date, opts)
      : formatDateTime(date, opts);
  const secondary =
    effective === 'relative'
      ? formatDateTime(date, opts)
      : formatRelative(date, opts);

  return (
    <AppText accessibilityHint={secondary} style={style} testID={testID}>
      {primary}
    </AppText>
  );
}
