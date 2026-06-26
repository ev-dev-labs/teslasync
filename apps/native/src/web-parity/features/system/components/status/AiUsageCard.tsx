/**
 * AiUsageCard — native parity port of
 * web/src/features/system/components/status/AiUsageCard.tsx.
 *
 * Operator-grade per-call AI spend and volume detail card. The data
 * source is the per-call audit log written by the `WithAudit` provider
 * decorator (the `/ai/usage/*` endpoints), surfaced through the already
 * ported `useAiUsage` hooks.
 *
 * Off-mode behaviour (ADR-015 §I4) is preserved: when `ai_mode === 'off'`
 * the public `AiUsageCard` returns `null` so the AI feature marker never
 * mounts. The gate is hand-rolled (instead of `withAiFeature('__usage__')`)
 * because `__usage__` is a server-side meta feature gated only on
 * `ai_mode != 'off'` with no per-feature toggle.
 *
 * Native deviations from the web original:
 *   - The web delegated rendering to the shared `<UsageCard>` primitive in
 *     components/data-display, which is not yet ported. Its bands/details/
 *     top-lists/empty-message subset (the only parts this card uses — it
 *     never passes budget/banner/footer) is inlined here with React Native
 *     primitives, preserving the same visual contract (intent-tinted band
 *     rings, intent-coloured detail values, 3 at-a-glance bands, a key/value
 *     detail grid and the by-feature / recent-calls top-lists).
 *   - The DOM marker `<div data-ai-feature="__usage__" data-testid="ai-feature-usage">`
 *     becomes a `<View nativeID testID accessibilityLabel collapsable={false}>`
 *     so the off-mode invariant tests can still locate (or fail to locate)
 *     the surface (same convention as the native `withAiFeature`).
 *   - lucide-react icons (Activity/Cpu/Clock/Zap) are SVG/DOM components; they
 *     render here as small decorative glyph stand-ins (same convention as the
 *     APIUsageWidget port).
 *   - `@/hooks/useFormatting` (`formatCurrency`) and `@/lib/numberFormat`
 *     (`fmtInt`) are reproduced as native-safe shims mirroring the web
 *     out-of-box defaults ('$' symbol, precision 2, en-US locale).
 *   - `@/hooks/useSettings` (the app-level hook returning `{ settings }`) is
 *     swapped for the native parity `useSettings` API hook returning
 *     `{ data: settings }`; the gate logic is identical.
 */

import React, {useMemo, type ReactNode} from 'react';
import {StyleSheet, View, type ViewStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';
import {
  useAiUsageToday,
  useAiUsageByFeature,
  useAiUsageRecent,
  type AiUsageRecentRow,
} from '../../../../api/hooks/useAiUsage';
import {useSettings} from '../../../../api/hooks/useSettings';

/** Feature ID this card represents. Keep in sync with registry. */
export const AI_USAGE_FEATURE_ID = '__usage__' as const;
const AI_USAGE_TEST_ID = 'ai-feature-usage';

// lucide-react icons are DOM/SVG components; native renders them as small
// decorative glyph stand-ins (same convention as the APIUsageWidget port).
const ICON_ACTIVITY = '\u223F'; // lucide Activity
const ICON_CPU = '\u25A6'; // lucide Cpu
const ICON_CLOCK = '\u23F1'; // lucide Clock
const ICON_ZAP = '\u26A1'; // lucide Zap

// ── native-safe number formatting (web `@/lib/numberFormat`) ─────────────────
const DEFAULT_PRECISION = 2;
const DEFAULT_CURRENCY_SYMBOL = '$';

function fmtNumber(v: unknown, decimals = DEFAULT_PRECISION, locale = 'en-US'): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  try {
    return n.toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function fmtInt(n: number): string {
  return fmtNumber(n, 0);
}

// ── native formatting shim (web `@/hooks/useFormatting`) ─────────────────────
interface UseFormattingResult {
  formatCurrency: (amount: number, decimals?: number) => string;
}

// Mirrors the web out-of-box defaults: currency symbol '$', precision 2.
function useFormatting(): UseFormattingResult {
  return useMemo<UseFormattingResult>(
    () => ({
      formatCurrency: (amount, decimals) =>
        `${DEFAULT_CURRENCY_SYMBOL}${fmtNumber(amount, decimals ?? DEFAULT_PRECISION)}`,
    }),
    [],
  );
}

// ── data helpers (ported verbatim from the web original) ─────────────────────
function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return '—';
  }
  return fmtInt(n);
}

function microCentsToDollars(mc: number | null | undefined): number {
  if (mc == null || !Number.isFinite(mc)) {
    return 0;
  }
  // 1 cent = 10_000 micro-cents → 1 dollar = 1_000_000 micro-cents.
  return mc / 1_000_000;
}

function formatRelativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return iso;
  }
  const ageMs = now - t;
  if (ageMs < 60_000) {
    return `${Math.max(0, Math.round(ageMs / 1000))}s ago`;
  }
  if (ageMs < 3_600_000) {
    return `${Math.round(ageMs / 60_000)}m ago`;
  }
  if (ageMs < 86_400_000) {
    return `${Math.round(ageMs / 3_600_000)}h ago`;
  }
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

function summarizeRecentRow(row: AiUsageRecentRow, now: number): string {
  const tokens = row.input_tokens + row.output_tokens;
  const tokenStr = tokens > 0 ? `${fmtInt(tokens)} tok` : '0 tok';
  return `${row.feature_id} · ${row.model} · ${tokenStr} · ${formatRelativeTime(
    row.started_at,
    now,
  )}`;
}

// ── inlined UsageCard primitive (web components/data-display/UsageCard) ───────
// Visual intent driving accent colour for tinted bands / detail values.
type UsageCardIntent = 'normal' | 'warn' | 'danger';

interface UsageCardBand {
  iconGlyph?: string;
  label: string;
  value: string;
  /** Small muted suffix rendered after the value (web `<span>` child). */
  valueUnit?: string;
  sub?: string;
  intent?: UsageCardIntent;
}

interface UsageCardDetail {
  label: string;
  value: string;
  intent?: UsageCardIntent;
}

interface UsageCardTopListItem {
  key: string;
  label: string;
  value: string;
}

interface UsageCardTopList {
  key: string;
  iconGlyph?: string;
  title: string;
  items: UsageCardTopListItem[];
}

interface UsageCardProps {
  bands?: UsageCardBand[];
  details?: UsageCardDetail[];
  topLists?: UsageCardTopList[];
  emptyMessage?: string;
}

const intentValueColor: Record<UsageCardIntent, string> = {
  normal: colors.textPrimary,
  warn: colors.warning,
  danger: colors.danger,
};

function UsageCard({bands, details, topLists, emptyMessage}: UsageCardProps) {
  const hasAnything =
    (bands != null && bands.length > 0) ||
    (details != null && details.length > 0) ||
    (topLists != null && topLists.length > 0);

  if (!hasAnything) {
    return (
      <AppText style={styles.emptyMessage}>
        {emptyMessage ?? 'No data to display yet.'}
      </AppText>
    );
  }

  return (
    <View style={styles.cardRoot}>
      {bands != null && bands.length > 0 ? <BandsSection bands={bands} /> : null}
      {details != null && details.length > 0 ? (
        <DetailsSection details={details} />
      ) : null}
      {topLists != null && topLists.length > 0 ? (
        <TopListsSection topLists={topLists} />
      ) : null}
    </View>
  );
}

function BandsSection({bands}: {bands: UsageCardBand[]}) {
  return (
    <View style={styles.bandsGrid}>
      {bands.map((b, i) => {
        const intent = b.intent ?? 'normal';
        return (
          <View key={i} style={[styles.band, bandRingStyles[intent]]}>
            <View style={styles.labelRow}>
              {b.iconGlyph ? (
                <AppText importantForAccessibility="no" style={styles.glyph}>
                  {b.iconGlyph}
                </AppText>
              ) : null}
              <AppText style={styles.label}>{b.label}</AppText>
            </View>
            <AppText style={styles.bandValue}>
              {b.value}
              {b.valueUnit ? (
                <AppText style={styles.bandValueUnit}> {b.valueUnit}</AppText>
              ) : null}
            </AppText>
            {b.sub ? <AppText style={styles.bandSub}>{b.sub}</AppText> : null}
          </View>
        );
      })}
    </View>
  );
}

function DetailsSection({details}: {details: UsageCardDetail[]}) {
  return (
    <View style={styles.detailsGrid}>
      {details.map((d, i) => {
        const intent = d.intent ?? 'normal';
        return (
          <View key={i} style={styles.detailItem}>
            <AppText style={styles.detailLabel}>{d.label}</AppText>
            <AppText style={[styles.detailValue, {color: intentValueColor[intent]}]}>
              {d.value}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

function TopListsSection({topLists}: {topLists: UsageCardTopList[]}) {
  return (
    <View style={styles.topLists}>
      {topLists.map(tl => (
        <View key={tl.key} style={styles.topList}>
          <View style={styles.labelRow}>
            {tl.iconGlyph ? (
              <AppText importantForAccessibility="no" style={styles.glyph}>
                {tl.iconGlyph}
              </AppText>
            ) : null}
            <AppText style={styles.label}>{tl.title}</AppText>
          </View>
          <View style={styles.topListItems}>
            {tl.items.map(item => (
              <View key={item.key} style={styles.topListRow}>
                <AppText numberOfLines={1} style={styles.topListLabel}>
                  {item.label}
                </AppText>
                <AppText style={styles.topListValue}>{item.value}</AppText>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// Native equivalent of the web `<div data-ai-feature data-testid>` marker.
function UsageMarker({children}: {children: ReactNode}) {
  return (
    <View
      accessibilityLabel={`AI feature ${AI_USAGE_FEATURE_ID}`}
      collapsable={false}
      nativeID={AI_USAGE_FEATURE_ID}
      testID={AI_USAGE_TEST_ID}>
      {children}
    </View>
  );
}

/**
 * Inner component — assumes the gate has already opened. Keeps the gate
 * logic out of the data-fetching path so unit tests can render this
 * directly without mocking the settings hook.
 */
export function AiUsageCardInner() {
  const {formatCurrency} = useFormatting();
  const todayQuery = useAiUsageToday();
  const byFeatureQuery = useAiUsageByFeature();
  const recentQuery = useAiUsageRecent(10);

  const isLoading =
    todayQuery.isLoading || byFeatureQuery.isLoading || recentQuery.isLoading;
  const today = todayQuery.data;
  const byFeature = byFeatureQuery.data?.rows ?? [];
  const recent = recentQuery.data?.rows ?? [];

  // Stable "now" for relative-time labels in this render. Recomputed every
  // time React re-renders on a query-cache update, which is sufficient —
  // these labels are coarse (seconds / minutes / hours).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [today, byFeature, recent]);

  if (isLoading && !today) {
    return (
      <UsageMarker>
        <UsageCard emptyMessage="Loading Helix usage…" />
      </UsageMarker>
    );
  }

  if (!today || today.call_count === 0) {
    return (
      <UsageMarker>
        <UsageCard emptyMessage="No Helix calls yet — turn on a feature to start." />
      </UsageMarker>
    );
  }

  const totalTokens = today.input_tokens + today.output_tokens;
  const todayCost = microCentsToDollars(today.cost_micro_cents);

  const errorIntent: UsageCardIntent =
    today.error_count > 0 && today.call_count > 0
      ? today.error_count / today.call_count >= 0.05
        ? 'danger'
        : 'warn'
      : 'normal';

  const bands: UsageCardBand[] = [
    {
      iconGlyph: ICON_ACTIVITY,
      label: 'Today',
      value: fmtCount(today.call_count),
      valueUnit: 'calls',
      sub: `${fmtCount(today.error_count)} error${
        today.error_count === 1 ? '' : 's'
      }`,
      intent: errorIntent,
    },
    {
      iconGlyph: ICON_CPU,
      label: 'Tokens',
      value: fmtCount(totalTokens),
      valueUnit: 'total',
      sub: `${fmtCount(today.input_tokens)} in · ${fmtCount(
        today.output_tokens,
      )} out`,
    },
    {
      iconGlyph: ICON_CLOCK,
      label: 'Cost / latency',
      value: formatCurrency(todayCost),
      sub: `${Math.round(today.avg_latency_ms)} ms avg`,
    },
  ];

  const details: UsageCardDetail[] = [
    {
      label: 'Avg latency',
      value: `${Math.round(today.avg_latency_ms)} ms`,
    },
    {
      label: 'Errors',
      value: fmtCount(today.error_count),
      intent: today.error_count > 0 ? 'danger' : 'normal',
    },
    {
      label: 'Input tokens',
      value: fmtCount(today.input_tokens),
    },
    {
      label: 'Output tokens',
      value: fmtCount(today.output_tokens),
    },
  ];

  const topLists: UsageCardTopList[] = [];

  if (byFeature.length > 0) {
    const topFeatures = [...byFeature]
      .sort((a, b) => b.call_count - a.call_count)
      .slice(0, 5);
    topLists.push({
      key: 'features',
      iconGlyph: ICON_ZAP,
      title: 'By feature (7 days)',
      items: topFeatures.map<UsageCardTopListItem>(f => ({
        key: f.feature_id,
        label: f.feature_id,
        value: fmtCount(f.call_count),
      })),
    });
  }

  if (recent.length > 0) {
    topLists.push({
      key: 'recent',
      iconGlyph: ICON_CLOCK,
      title: 'Recent calls',
      items: recent.slice(0, 5).map<UsageCardTopListItem>(r => ({
        key: String(r.id),
        label: summarizeRecentRow(r, now),
        value: r.error ? '✗' : '✓',
      })),
    });
  }

  return (
    <UsageMarker>
      <UsageCard bands={bands} details={details} topLists={topLists} />
    </UsageMarker>
  );
}

/**
 * Public wrapper — gates rendering on `ai_mode != 'off'`. Returns `null`
 * (and therefore mounts no AI marker) when AI is fully off, preserving
 * ADR-015 §I4.
 */
export function AiUsageCard() {
  const {data: settings} = useSettings();
  if (!settings) {
    return null;
  }
  if (settings.ai_mode === undefined || settings.ai_mode === 'off') {
    return null;
  }
  return <AiUsageCardInner />;
}

const styles = StyleSheet.create({
  cardRoot: {
    gap: 16,
  },
  emptyMessage: {
    fontSize: 14,
    color: colors.textMuted,
  },
  bandsGrid: {
    gap: 12,
  },
  band: {
    borderRadius: 8,
    padding: 12,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  glyph: {
    fontSize: 12,
    color: colors.textMuted,
  },
  label: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  bandValue: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  bandValueUnit: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textMuted,
  },
  bandSub: {
    fontSize: 12,
    color: colors.textMuted,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 4,
  },
  detailItem: {
    width: '47%',
  },
  detailLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  detailValue: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  topLists: {
    gap: 12,
  },
  topList: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  topListItems: {
    marginTop: 8,
    gap: 4,
  },
  topListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  topListLabel: {
    flexShrink: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  topListValue: {
    fontSize: 14,
    color: colors.textPrimary,
  },
});

const bandRingStyles = StyleSheet.create<Record<UsageCardIntent, ViewStyle>>({
  normal: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  warn: {
    backgroundColor: colors.warningSurface,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
});
