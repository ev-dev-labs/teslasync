// Native parity port of web/src/components/data-display/format/DateTime.tsx.
//
// The web component imports four browser-oriented modules that have no native
// counterpart in this tree yet: @/lib/dateFormat (the Intl date/time
// formatters + tzAbbreviation), @/lib/locale (resolveLocale), @/lib/timezone
// (TzMode / resolveTimezone / useTimezone) and @/hooks/useSettings. Their pure
// logic is ported verbatim and kept self-contained below so behavior — variant
// selection, locale fallback, timezone resolution, and the canonical ISO
// "title" string — matches the web renderer byte-for-byte. The DOM <span> +
// title (hover tooltip) + className surface becomes an AppText whose ISO string
// is exposed through accessibilityLabel (React Native has no hover tooltip).
// React Native also has no selected-vehicle context, so resolveTimezone is
// handed a null vehicle tz and 'vehicle' mode degrades to the user/device tz.

import React from 'react';
import {type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {useSettings} from '../../../api/hooks/useSettings';

/** Optional locale + timezone overrides for the shared formatters. */
export interface FormatOptions {
  /** IANA timezone name, e.g. 'America/Los_Angeles'. Defaults to device. */
  tz?: string;
  /** BCP-47 locale, e.g. 'en-US'. Defaults to device locale. */
  locale?: string;
}

/** Time-zone display modes for rendering timestamps while data stays UTC. */
export type TzMode = 'vehicle' | 'user' | 'utc';

/** Universal placeholder returned by every formatter for unrenderable input. */
const FALLBACK = '—';

function intlOpts(
  base: Intl.DateTimeFormatOptions,
  opts?: FormatOptions,
): Intl.DateTimeFormatOptions {
  if (opts?.tz) {
    return {...base, timeZone: opts.tz};
  }
  return base;
}

function intlLocale(opts?: FormatOptions): string | undefined {
  const raw = opts?.locale;
  // Empty / whitespace-only strings would throw RangeError if handed to Intl.*.
  // Treat them as "no override" so the runtime falls back to the device locale.
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw;
  }
  return undefined;
}

/** Full date + time: "Apr 4, 2026, 2:30 AM" */
function formatDateTime(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return FALLBACK;
  }
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

/** Date only: "Apr 4, 2026" */
function formatDate(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString(
    intlLocale(opts),
    intlOpts({year: 'numeric', month: 'short', day: 'numeric'}, opts),
  );
}

/** Short date: "Apr 4" */
function formatDateShort(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString(
    intlLocale(opts),
    intlOpts({month: 'short', day: 'numeric'}, opts),
  );
}

/** Time only: "02:30" (24h) or "2:30 AM" (based on locale) */
function formatTime(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return FALLBACK;
  }
  const localeArg = intlLocale(opts);
  return d.toLocaleTimeString(
    localeArg ? localeArg : [],
    intlOpts({hour: '2-digit', minute: '2-digit'}, opts),
  );
}

/** Relative time matching activity feeds: "Just now", "5m ago", or absolute. */
function formatRelativeTime(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) {
    return 'Just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) {
    return `${diffHrs}h ago`;
  }
  return d.toLocaleDateString(
    intlLocale(opts),
    intlOpts(
      {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'},
      opts,
    ),
  );
}

/**
 * Returns the short timezone abbreviation (e.g. "PST", "EDT") for the given
 * timestamp in the given IANA zone. Date-aware so DST transitions are honored.
 */
function tzAbbreviation(value: string | Date, tz: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) {
    return '';
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** Single source of truth for BCP-47 fallback when a locale is empty/unset. */
function resolveLocale(locale: string | null | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return 'en-US';
}

/** Resolves the device's IANA timezone, or 'UTC' if Intl is unavailable. */
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Pure helper to compute the IANA timezone string from a mode + the vehicle's
 * reported tz + the user's optional override. Mirrors web/src/lib/timezone.ts.
 */
export function resolveTimezone(
  mode: TzMode,
  vehicleTz?: string | null,
  userOverride?: string | null,
): string {
  if (mode === 'utc') {
    return 'UTC';
  }
  const userTz =
    userOverride && userOverride.trim() ? userOverride : deviceTimezone();
  if (mode === 'user') {
    return userTz;
  }
  if (!vehicleTz || vehicleTz === 'UTC') {
    return userTz;
  }
  return vehicleTz;
}

/**
 * Hook returning the IANA timezone for the given mode, sourcing the user's
 * optional override from useSettings(). Native has no selected-vehicle context,
 * so the vehicle tz is unavailable and 'vehicle' mode degrades to user/device.
 */
function useTimezone(mode: TzMode = 'vehicle'): string {
  const {data: settings} = useSettings();
  return resolveTimezone(mode, null, settings?.timezone_user ?? null);
}

export type DateTimeVariant = 'full' | 'date' | 'time' | 'relative' | 'short';

interface DateTimeProps {
  value: string | Date | null | undefined;
  variant?: DateTimeVariant;
  /**
   * Override which timezone the timestamp is rendered in. When unset the
   * component preserves its prior pure behavior (uses the device's locale +
   * timezone) — the back-compat path used by call sites and tests that render
   * outside Query providers.
   *
   * When set, the component subscribes to `useSettings()` to resolve the IANA
   * name. See `resolveTimezone` for the resolution rules.
   */
  in?: TzMode;
  /** When true, append the short tz abbreviation (e.g. "PST") after the value. */
  showTz?: boolean;
  /** Accepted for web parity; not applied on native (no className styling). */
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Locale-aware datetime renderer that exposes the canonical ISO string via
 * accessibilityLabel for unambiguous timestamps. Wraps the pure helpers ported
 * from web `@/lib/dateFormat`.
 *
 * When `in` or `showTz` is set, renders via the provider-aware variant
 * `<DateTimeWithTz>`. The default no-prop path stays pure to keep render cost
 * low across list-heavy screens.
 */
export function DateTime(props: DateTimeProps) {
  if (props.in !== undefined || props.showTz) {
    return <DateTimeWithTz {...props} />;
  }
  return <PureDateTime {...props} />;
}

function PureDateTime({
  value,
  variant = 'full',
  className,
  style,
  testID,
}: DateTimeProps) {
  return renderText({value, variant, className, style, testID});
}

/**
 * Renders the timestamp in the IANA timezone resolved from the user's settings.
 * Always calls `useSettings` and `useTimezone` so React's hook rules are honored
 * regardless of which branch was taken on the previous render — this component
 * is mounted only when `in` / `showTz` is set, so the render path is consistent
 * for the lifetime of any given DateTime instance.
 */
function DateTimeWithTz({
  value,
  variant = 'full',
  in: mode,
  showTz,
  className,
  style,
  testID,
}: DateTimeProps) {
  const {data: settings} = useSettings();
  const effectiveMode = (mode ??
    settings?.tz_display_default ??
    'vehicle') as TzMode;
  const tz = useTimezone(effectiveMode);
  const locale = resolveLocale(settings?.locale);
  return renderText({
    value,
    variant,
    className,
    style,
    testID,
    opts: {tz, locale},
    showTz,
    tz,
  });
}

interface RenderArgs {
  value: string | Date | null | undefined;
  variant: DateTimeVariant;
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  opts?: FormatOptions;
  showTz?: boolean;
  tz?: string;
}

function renderText({
  value,
  variant,
  className: _className,
  style,
  testID,
  opts,
  showTz,
  tz,
}: RenderArgs) {
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
    <AppText accessibilityLabel={title} style={style} testID={testID}>
      {display}
      {abbrev ? (
        <AppText testID="datetime-tz-abbrev" tone="muted" variant="caption">
          {' '}
          {abbrev}
        </AppText>
      ) : null}
    </AppText>
  );
}
