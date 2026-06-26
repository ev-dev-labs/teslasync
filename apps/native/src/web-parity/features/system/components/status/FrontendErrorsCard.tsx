// Native parity port of
// web/src/features/system/components/status/FrontendErrorsCard.tsx.
//
// FrontendErrorsCard — last-hour rolling summary of browser-reported frontend
// errors (the same data that backed the now-deleted /admin page's "Frontend
// Errors" panel). Surfaces the total error count plus top offenders
// (component + route + count) so operators can immediately see whether the SPA
// is misbehaving without leaving /system-status. Pulls from
// useWebErrorsSummary() (GET /admin/web-errors/summary) and renders inside the
// existing "Recent errors" accordion as a sibling of the backend error list.
//
// Native-safe substitutions (rules 4-7), documented in the parity sidecar:
//   • lucide-react `<Bug>` -> the parity SemanticIcon `bug` glyph ('BG')
//     rendered as an AppText in the muted color the web icon inherits from the
//     uppercase header row (CollapsibleCommandGroup leading-icon precedent).
//     The parity bundle ships no lucide-react / SVG icon set.
//   • shared web `<Badge variant="neutral" size="sm">` -> an inline RN View +
//     AppText neutral pill matching the web dark-mode neutral variant
//     (bg gray-700 / text gray-200) at the sm padding (StateBadge exact-hex
//     precedent); the shared web UI-kit Badge is not imported.
//   • `@/lib/numberFormat` `fmtInt` -> inlined verbatim (fmtNumber(v, 0)): a
//     safe-number guard (nullish / non-finite -> 0) + locale-aware integer
//     grouping at the web module default locale 'en-US' (this card never
//     threads useSettings, so the module global default applies), keeping the
//     source's bad-locale en-US try/catch fallback.
//   • `@/components/feedback/Skeleton` -> the native parity Skeleton; the web
//     `className="h-6"` (1.5rem) loading bars become `height={24}`.
//   • Tailwind utility classes + CSS vars + the DOM <div>/<span>/<ul>/<li>/<p>
//     tree -> RN View/AppText primitives, a StyleSheet, and theme tokens. The
//     `divide-y` row separators become a per-row top border on every item after
//     the first; `truncate` -> numberOfLines={1}; `tabular-nums` ->
//     fontVariant ['tabular-nums']; `font-mono` -> fontFamily 'monospace';
//     text-cyan-300 -> its #67e8f9 hex; bg-white/[0.02], ring-white/[0.05] and
//     divide-white/[0.04] -> their literal rgba forms.
// No DOM elements, lucide-react, Recharts, Leaflet, or web UI-kit modules are
// imported into the native output.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {useWebErrorsSummary} from '../../../../api/hooks/useAdmin';
import {Skeleton} from '../../../../components/feedback/Skeleton';

/* ─── inlined @/lib/numberFormat fmtInt ─────────────────────────────────── */

// web numberFormat module default locale (set globally by useSettings). This
// card never threads settings, so the module's shipped en-US default applies.
const DEFAULT_LOCALE = 'en-US';

// web safeNumber: nullish / NaN / Infinity -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// web fmtInt(v) = fmtNumber(v, 0): integer grouping with the source's
// bad-locale en-US try/catch fallback.
function fmtInt(v: unknown): string {
  try {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
}

/* ─── inlined visual tokens ─────────────────────────────────────────────── */

// lucide Bug -> parity SemanticIcon 'bug' glyph, rendered muted like the web
// header row that owns the text color.
const BUG_GLYPH = getSemanticIconDefinition('bug').glyph;

// web bg-white/[0.02] card fill, ring-white/[0.05] hairline, and
// divide-white/[0.04] row separators -> their literal rgba forms.
const CARD_BG = 'rgba(255, 255, 255, 0.02)';
const CARD_RING = 'rgba(255, 255, 255, 0.05)';
const ROW_DIVIDER = 'rgba(255, 255, 255, 0.04)';

// web text-cyan-300 route text (toned-down per the body-text rules).
const CYAN_300 = '#67e8f9';

// web Badge neutral variant, dark mode: bg gray-700 (#374151), text gray-200.
const BADGE_BG = '#374151';
const BADGE_TEXT = '#e5e7eb';

export function FrontendErrorsCard() {
  const {data, isLoading} = useWebErrorsSummary();

  if (isLoading) {
    return (
      <View style={styles.loadingGroup}>
        <Skeleton height={24} />
        <Skeleton height={24} />
      </View>
    );
  }

  if (!data) {
    return (
      <AppText style={styles.unavailable}>
        Unable to load frontend error summary.
      </AppText>
    );
  }

  const total = data.total ?? 0;
  const top = data.top ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <AppText style={styles.headerIcon}>{BUG_GLYPH}</AppText>
        <AppText style={styles.headerLabel}>Frontend errors (last hour)</AppText>
      </View>

      <View style={styles.totalRow}>
        <AppText style={styles.totalValue}>{fmtInt(total)}</AppText>
        <AppText style={styles.totalCaption}>
          reported by browser sessions
        </AppText>
      </View>

      {top.length > 0 ? (
        <View style={styles.list}>
          {top.map((entry, idx) => (
            <View
              key={`${entry.name}|${entry.route}|${idx}`}
              style={[styles.row, idx > 0 ? styles.rowDivided : null]}>
              <View style={styles.rowLeft}>
                <View style={styles.badge}>
                  <AppText style={styles.badgeText}>
                    {entry.name || '—'}
                  </AppText>
                </View>
                <AppText numberOfLines={1} style={styles.route}>
                  {entry.route || '—'}
                </AppText>
              </View>
              <AppText style={styles.count}>{fmtInt(entry.count ?? 0)}</AppText>
            </View>
          ))}
        </View>
      ) : (
        <AppText style={styles.empty}>
          No frontend errors reported in the last hour.
        </AppText>
      )}
    </View>
  );
}

FrontendErrorsCard.displayName = 'FrontendErrorsCard';

const styles = StyleSheet.create({
  // space-y-2 mt-4
  loadingGroup: {
    marginTop: 16,
    gap: spacing.sm,
  },
  // mt-4 text-xs text-[var(--text-muted)]
  unavailable: {
    marginTop: 16,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  // mt-4 rounded-md bg-white/[0.02] p-3 ring-1 ring-white/[0.05]
  card: {
    marginTop: 16,
    borderRadius: 6,
    backgroundColor: CARD_BG,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: CARD_RING,
  },
  // flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--text-muted)]
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.textMuted,
  },
  headerLabel: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  // mt-2 flex items-baseline gap-2
  totalRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  // text-2xl font-semibold tabular-nums text-[var(--text-primary)]
  totalValue: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
  // text-xs text-[var(--text-muted)]
  totalCaption: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  // mt-3 divide-y divide-white/[0.04]
  list: {
    marginTop: spacing.md,
  },
  // flex items-center justify-between gap-2 py-1.5
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: ROW_DIVIDER,
  },
  // flex min-w-0 items-center gap-2
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  // Badge variant="neutral" size="sm": rounded-full px-1.5 py-0.5 font-medium
  badge: {
    flexShrink: 0,
    alignSelf: 'flex-start',
    borderRadius: 9999,
    backgroundColor: BADGE_BG,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: BADGE_TEXT,
  },
  // truncate font-mono text-xs text-cyan-300
  route: {
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
    color: CYAN_300,
  },
  // shrink-0 tabular-nums text-xs text-[var(--text-primary)]
  count: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
  // mt-2 text-xs text-[var(--text-muted)]
  empty: {
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
});
