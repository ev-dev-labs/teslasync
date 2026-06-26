/**
 * DLQ Inspector — status header (native parity port of
 * web/src/features/admin/components/dlq-inspector/StatusHeader.tsx).
 *
 * Renders three stat cards summarising the current DLQ state and a warning
 * banner when `replay_enabled` is false so an operator immediately sees that
 * the replay button below will return HTTP 403 instead of publishing.
 *
 * Native adaptations vs. the web source (behavior/state/keys/API intent kept):
 *   - web `data-display` `StatCard` (Card + Skeleton) -> an inline RN stat card
 *     (bordered View + AppText): label row with a decorative glyph, the big
 *     value, and the muted sublabel. The parent already passes the '—'
 *     placeholder while loading, so the web Skeleton branch is unnecessary.
 *   - web `layout` `Grid cols={{default:1, sm:3}}` -> a flex-wrap row where each
 *     card has flexBasis:220 so it stacks 1-up on a narrow phone (web
 *     grid-cols-1) and sits 3-up on a wide tablet/desktop window (web
 *     sm:grid-cols-3).
 *   - web `feedback` `AlertBanner variant="warning"` -> an inline RN warning
 *     banner (warning-tinted bordered View) with the same title + body copy.
 *   - lucide-react `Inbox`/`ShieldCheck`/`AlertOctagon` (DOM SVG) -> decorative
 *     text glyphs (▤ / ✓ / ⚠), matching the EntryDrawer glyph approach.
 *   - `@/lib/numberFormat` `fmtInt` ported inline (same safeNumber guard, 0
 *     decimals, locale-aware).
 *   - react-i18next `useTranslation` -> a native-safe t(key, fallback) fallback
 *     preserving every key + English default.
 *   - `DLQListResponse` type imported from the native useDLQ hook (which
 *     re-exports it) rather than `@/types/admin-diagnostics`.
 */

import React, {useCallback} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../../theme/tokens';
import type {DLQListResponse} from '../../../../api/hooks/useDLQ';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ---- Ported integer formatting (web/src/lib/numberFormat.ts: fmtInt) --------

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Locale-aware integer (web `fmtInt` = `fmtNumber(v, 0)`). */
function fmtInt(value: unknown): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(safeNumber(value)));
  }
}

// ---- Inline StatCard (web data-display StatCard) ----------------------------

function StatCard({
  label,
  value,
  glyph,
  sublabel,
}: {
  label: string;
  value: string;
  glyph: string;
  sublabel: string;
}): React.ReactElement {
  return (
    <View style={styles.card}>
      <View style={styles.cardLabelRow}>
        <AppText style={styles.cardLabel} variant="caption" weight="semibold">
          {label}
        </AppText>
        <AppText style={styles.cardGlyph}>{glyph}</AppText>
      </View>
      <AppText style={styles.cardValue} variant="title" weight="bold">
        {value}
      </AppText>
      <AppText style={styles.cardSublabel} tone="muted" variant="caption">
        {sublabel}
      </AppText>
    </View>
  );
}

// ---- Inline AlertBanner (web feedback AlertBanner, variant="warning") --------

function WarningBanner({
  title,
  message,
}: {
  title: string;
  message: string;
}): React.ReactElement {
  return (
    <View style={styles.banner}>
      <AppText style={styles.bannerGlyph}>⚠</AppText>
      <View style={styles.bannerBody}>
        <AppText style={styles.bannerTitle} weight="semibold">
          {title}
        </AppText>
        <AppText style={styles.bannerMessage} variant="caption">
          {message}
        </AppText>
      </View>
    </View>
  );
}

// ---- Component --------------------------------------------------------------

export interface StatusHeaderProps {
  data: DLQListResponse | undefined;
  loading: boolean;
}

export function StatusHeader({
  data,
  loading,
}: StatusHeaderProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const count = data?.count ?? 0;
  const replayable = (data?.entries ?? []).filter(e => e.replayable).length;
  const enabled = data?.replay_enabled ?? false;

  return (
    <View style={styles.root}>
      <View style={styles.grid}>
        <StatCard
          glyph="▤"
          label={t('admin.dlq.stats.total', 'Total entries')}
          sublabel={t('admin.dlq.stats.totalSub', 'in dead-letter queue')}
          value={loading ? '—' : fmtInt(count)}
        />
        <StatCard
          glyph="✓"
          label={t('admin.dlq.stats.replayable', 'Replayable')}
          sublabel={t('admin.dlq.stats.replayableSub', 'parsed with source topic')}
          value={loading ? '—' : fmtInt(replayable)}
        />
        <StatCard
          glyph="⚠"
          label={t('admin.dlq.stats.replayMode', 'Replay mode')}
          sublabel={t('admin.dlq.stats.replayModeSub', 'DLQ_REPLAY_ENABLED env')}
          value={
            loading
              ? '—'
              : enabled
                ? t('admin.dlq.stats.enabled', 'Enabled')
                : t('admin.dlq.stats.disabled', 'Disabled')
          }
        />
      </View>

      {!loading && !enabled ? (
        <WarningBanner
          message={t(
            'admin.dlq.banners.disabledMessage',
            'The DLQ_REPLAY_ENABLED env flag is not set on this server. Replay attempts will return HTTP 403 and be logged as result="disabled".',
          )}
          title={t('admin.dlq.banners.disabledTitle', 'DLQ replay is disabled')}
        />
      ) : null}
    </View>
  );
}

StatusHeader.displayName = 'StatusHeader';

const styles = StyleSheet.create({
  banner: {
    alignItems: 'flex-start',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  bannerBody: {
    flex: 1,
    gap: 2,
  },
  bannerGlyph: {
    color: colors.warning,
    fontSize: typography.body,
    lineHeight: 20,
  },
  bannerMessage: {
    color: colors.textSecondary,
  },
  bannerTitle: {
    color: colors.warning,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: 220,
    flexGrow: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  cardGlyph: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 20,
  },
  cardLabel: {
    color: colors.textMuted,
    flexShrink: 1,
  },
  cardLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardSublabel: {
    color: colors.textMuted,
  },
  cardValue: {
    color: colors.textPrimary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  root: {
    gap: spacing.md,
  },
});

export default StatusHeader;
