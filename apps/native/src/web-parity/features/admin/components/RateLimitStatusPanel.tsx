// Native parity port of
// web/src/features/admin/components/RateLimitStatusPanel.tsx.
//
// Admin status panel that renders one MetricBar per ScopeBudget the backend
// reports under GET /api/v1/system/rate-limits. Bars climb as the rolling-window
// or token-bucket budget fills; severity comes straight from the backend so
// threshold tuning is a single Go ship. Auto-refresh + "pause when hidden" live
// inside useRateLimitStatus, so this component stays purely presentational and a
// test can drive it with `testHookOverride` stub data exactly as on web.
//
// Native-safe adaptations (documented in the sidecar):
//   - The shared web @/components/data-display MetricBar (a framer-motion DOM
//     <div> with an animated-width gradient + glow) has no native parity
//     primitive, so its label-row + filled track is reproduced inline with
//     View + AppText: the same `pct = min((value/max)*100, 100)` fill, the
//     `sublabel ?? fmtNumber(value)` readout (?? preserved so an intentional
//     empty string still suppresses the value), and the per-row severity colour.
//     The width-grow animation is rendered as a static width (no Animated to
//     avoid open handles in tests); the CSS linear-gradient + box-shadow glow
//     collapse to a solid severity-coloured fill.
//   - @/components/ui GlassPanel -> the shared native GlassPanel.
//   - @/components/ui Button (ghost, lucide RefreshCw icon, loading spinner) ->
//     a native Pressable ghost button carrying a "\u27F3" refresh glyph that
//     swaps to an ActivityIndicator while refreshing (isFetching && !isLoading),
//     disabled while isFetching, onPress -> refetch() — preserving every state.
//   - @/components/ui/Typography Heading/Text/Caption -> AppText with the
//     matching size/weight/tone (panelTitle = 16px semibold, bodySm = 14px,
//     caption = 12px) so the heading hierarchy + secondary/muted tones survive.
//   - @/components/feedback Spinner -> RN ActivityIndicator.
//   - lucide AlertTriangle -> a danger-toned "\u26A0" glyph inside the rose
//     error card (colors.dangerBorder / dangerSurface / danger).
//   - @/lib/numberFormat fmtNumber + @/lib/dateFormat formatRelative /
//     formatDurationMsLong are inlined verbatim (default precision 2, the same
//     "just now / Nm ago / Nh ago / Nd ago / absolute date" and
//     "Nms / N.Ns / Nm NNs" ladders, "\u2014" fallback) without Intl/locale or
//     useSettings wiring, which native does not have yet.
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     that preserves every rateLimitStatus.* key, default, and {{var}}
//     interpolation contract verbatim.
//   - data-testid -> testID on every node so parity tests keep their selectors.
//
// No DOM, Recharts, Leaflet, framer-motion, lucide-react, or old web UI
// components are imported.

import React, {useCallback, useMemo} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useRateLimitStatus} from '../../../api/hooks/useSystem';
import type {RateLimitSeverity, ScopeBudget} from '../../../api/types';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type TVars = Record<string, string | number>;
type TFunc = (key: string, fallback: string, vars?: TVars) => string;

// react-i18next is not wired in native. i18next returns the supplied English
// default when a translation is missing, so the fallback returns that default
// (or the key) and applies the same {{var}} interpolation as the web `t`.
function useT(): TFunc {
  return useCallback((key: string, fallback: string, vars?: TVars) => {
    let out = fallback ?? key;
    if (vars) {
      for (const varKey of Object.keys(vars)) {
        out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
      }
    }
    return out;
  }, []);
}

/* ─── Inlined formatters (web @/lib/numberFormat + @/lib/dateFormat) ───── */

// Universal placeholder returned by the date/duration formatters (web FALLBACK).
const FALLBACK = '\u2014';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. The web global precision
// defaults to 2 (set by useSettings, which native does not wire), so 2 is the
// faithful unconfigured default.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// web formatDate — the absolute fallback used by formatRelative once a value is
// older than a week ("Apr 4, 2026").
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// web formatRelative — "just now", "3m ago", "2h ago", "5d ago", else absolute.
function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(iso);
}

// web formatDurationMsLong — "Nms", "N.Ns", or "Nm NNs" for longer refills.
function formatDurationMsLong(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return FALLBACK;
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec.toFixed(1)}s`;
  }
  const min = Math.floor(sec / 60);
  return `${min}m ${formatRoundedInt(sec % 60)}s`;
}

/* ─── Constants ───────────────────────────────────────────────────────── */

const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

const REFRESH_GLYPH = '\u27F3'; // lucide RefreshCw stand-in
const WARNING_GLYPH = '\u26A0'; // lucide AlertTriangle stand-in

// Severity -> hex colour passed into the bar (raw string for its dynamic fill),
// preserved verbatim from the web SEVERITY_COLOR map.
const SEVERITY_COLOR: Record<RateLimitSeverity, string> = {
  ok: '#10b981', // emerald-500
  warn: '#f59e0b', // amber-500
  critical: '#ef4444', // red-500
};

// web SEVERITY_TONE_CLASS (text-emerald-300 / text-amber-300 / text-rose-300)
// resolved to the toned-down 300-level hex for the native severity label.
const SEVERITY_TONE_COLOR: Record<RateLimitSeverity, string> = {
  ok: '#6ee7b7', // emerald-300
  warn: '#fcd34d', // amber-300
  critical: '#fda4af', // rose-300
};

/* ─── MetricBar (native reproduction of web data-display MetricBar) ────── */

interface MetricBarProps {
  value: number;
  max: number;
  color: string;
  label: string;
  sublabel?: string;
}

function MetricBar({value, max, color, label, sublabel}: MetricBarProps) {
  const pct = Math.min((value / max) * 100, 100);
  const fillWidth = `${pct}%` as DimensionValue;
  return (
    <View>
      <View style={styles.barLabelRow}>
        <AppText tone="secondary" numberOfLines={1} style={styles.barLabel}>
          {label}
        </AppText>
        <AppText style={[styles.barValue, {color}]}>
          {sublabel ?? fmtNumber(value)}
        </AppText>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, {width: fillWidth, backgroundColor: color}]} />
      </View>
    </View>
  );
}

/* ─── RateLimitRow ────────────────────────────────────────────────────── */

interface RateLimitRowProps {
  scope: ScopeBudget;
}

function RateLimitRow({scope}: RateLimitRowProps) {
  const t = useT();
  const color = SEVERITY_COLOR[scope.severity];
  const toneColor = SEVERITY_TONE_COLOR[scope.severity];

  const usageLabel = t('rateLimitStatus.usage', '{{current}} / {{limit}}', {
    current: fmtNumber(scope.current),
    limit: fmtNumber(scope.limit),
  });

  const windowLabel = useMemo(() => {
    if (!scope.window_seconds || scope.window_seconds <= 0) {
      return t('rateLimitStatus.windowInstant', 'Live snapshot');
    }
    return t('rateLimitStatus.windowSeconds', 'Last {{seconds}}s window', {
      seconds: scope.window_seconds,
    });
  }, [scope.window_seconds, t]);

  const resetLabel = useMemo(() => {
    if (!scope.reset_at) {
      return null;
    }
    const ms = new Date(scope.reset_at).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) {
      return null;
    }
    return t('rateLimitStatus.resetIn', 'Refills in {{duration}}', {
      duration: formatDurationMsLong(ms),
    });
  }, [scope.reset_at, t]);

  const severityLabel = t(
    `rateLimitStatus.severity.${scope.severity}`,
    scope.severity,
  );

  return (
    <View testID={`rate-limit-row-${scope.id}`} style={styles.row}>
      <View style={styles.rowHeader}>
        <AppText weight="semibold" numberOfLines={1} style={styles.rowName}>
          {scope.name}
        </AppText>
        <AppText
          style={[styles.severityLabel, {color: toneColor}]}
          testID={`rate-limit-severity-${scope.id}`}>
          {severityLabel}
        </AppText>
      </View>
      <MetricBar
        value={scope.current}
        max={scope.limit > 0 ? scope.limit : 1}
        color={color}
        label={windowLabel}
        sublabel={usageLabel}
      />
      {scope.detail || resetLabel ? (
        <View style={styles.rowFooter}>
          {scope.detail ? (
            <AppText tone="muted" style={styles.detail}>
              {scope.detail}
            </AppText>
          ) : (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          )}
          {resetLabel ? (
            <AppText tone="muted" style={styles.caption}>
              {resetLabel}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ─── RateLimitStatusPanel ────────────────────────────────────────────── */

export interface RateLimitStatusPanelProps {
  /** Override the auto-refresh hook for tests. */
  testHookOverride?: ReturnType<typeof useRateLimitStatus>;
}

export function RateLimitStatusPanel({
  testHookOverride,
}: RateLimitStatusPanelProps = {}) {
  const t = useT();
  const liveQuery = useRateLimitStatus({enabled: !testHookOverride});
  const query = testHookOverride ?? liveQuery;

  const data = query.data;
  const isLoading = query.isLoading;
  const isFetching = query.isFetching;
  const error = query.error;
  const refetch = query.refetch;

  const scopes = data?.scopes ?? [];

  const updatedLabel = useMemo(() => {
    if (!data?.generated_at) {
      return null;
    }
    return t('rateLimitStatus.lastUpdated', 'Updated {{when}}', {
      when: formatRelative(data.generated_at),
    });
  }, [data?.generated_at, t]);

  const refreshing = isFetching && !isLoading;
  const refreshLabel = t('rateLimitStatus.refresh', 'Refresh');

  return (
    <GlassPanel style={styles.panel} testID="rate-limit-status-panel">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText
            accessibilityRole="header"
            style={styles.title}>
            {t('rateLimitStatus.title', 'Rate-limit budgets')}
          </AppText>
          <AppText tone="secondary" style={styles.subtitle}>
            {t(
              'rateLimitStatus.subtitle',
              'Live view of every server-side throttle that affects this TeslaSync deployment. Bars climb as the window fills; colour switches from green to amber at 50% and to red at 80%.',
            )}
          </AppText>
          {updatedLabel ? (
            <AppText tone="muted" style={styles.updated}>
              {updatedLabel}
            </AppText>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={refreshLabel}
          accessibilityState={{disabled: isFetching, busy: refreshing}}
          disabled={isFetching}
          onPress={() => {
            void refetch();
          }}
          testID="rate-limit-refresh-button"
          style={({pressed}) => [
            styles.refreshButton,
            isFetching && styles.refreshButtonDisabled,
            pressed && !isFetching && styles.refreshButtonPressed,
          ]}>
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <AppText style={styles.refreshGlyph}>{REFRESH_GLYPH}</AppText>
          )}
          <AppText weight="semibold" style={styles.caption}>
            {refreshLabel}
          </AppText>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.loading} testID="rate-limit-loading">
          <ActivityIndicator size="small" color={colors.accent} />
          <AppText tone="secondary" style={styles.subtitle}>
            {t('rateLimitStatus.loading', 'Loading rate-limit status\u2026')}
          </AppText>
        </View>
      ) : error ? (
        <View style={styles.errorCard} testID="rate-limit-error">
          <AppText style={styles.errorGlyph}>{WARNING_GLYPH}</AppText>
          <AppText style={styles.errorText}>
            {t(
              'rateLimitStatus.error',
              'Could not load rate-limit status. Check API logs and try again.',
            )}
          </AppText>
        </View>
      ) : scopes.length === 0 ? (
        <AppText
          tone="secondary"
          style={styles.empty}
          testID="rate-limit-empty">
          {t(
            'rateLimitStatus.empty',
            'No rate-limited resources are currently observed. Counters appear here once the API has handled at least one request.',
          )}
        </AppText>
      ) : (
        <View style={styles.rows} testID="rate-limit-rows">
          {scopes.map(scope => (
            <RateLimitRow key={scope.id} scope={scope} />
          ))}
        </View>
      )}
    </GlassPanel>
  );
}

RateLimitStatusPanel.displayName = 'RateLimitStatusPanel';

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
    rowGap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: spacing.md,
  },
  headerText: {
    flex: 1,
    rowGap: spacing.xs,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  updated: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  refreshButtonDisabled: {
    opacity: 0.6,
  },
  refreshButtonPressed: {
    opacity: 0.82,
  },
  refreshGlyph: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.md,
    paddingVertical: spacing.lg,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: spacing.md,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  errorGlyph: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
  },
  empty: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  rows: {
    rowGap: spacing.lg,
  },
  row: {
    rowGap: 6,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: spacing.md,
  },
  rowName: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
  },
  severityLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  rowFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingTop: spacing.xs,
  },
  detail: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  barLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    marginBottom: 6,
  },
  barLabel: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  barValue: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: MONO_FONT,
  },
  barTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
});

export default RateLimitStatusPanel;
