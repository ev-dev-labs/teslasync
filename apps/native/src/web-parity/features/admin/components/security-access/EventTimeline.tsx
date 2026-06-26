// Native parity port of
// web/src/features/admin/components/security-access/EventTimeline.tsx.
//
// `EventTimeline` is the Security & Access "Security Event Timeline" panel: it
// renders a vertically scrolling, capped (max-h-96) list of semantic security
// state-change events (lock / sentry / door), each as a colored status circle +
// icon, a bold title, a muted subtitle, and a right-aligned relative timestamp.
// When the derived list is empty it shows an EmptyState instead of the list —
// the panel is always mounted so the empty state renders in place (behaviour
// preserved verbatim from the web source).
//
// The two pure helpers are carried over with identical control flow:
//   - `timelineIcon(ev)` (web L21-36) picked a lucide icon from ev.kind +
//     ev.variant. lucide-react is an SVG/DOM dependency with no native analog,
//     so this becomes `timelineIconGlyph(ev)` returning a short 2-char glyph
//     ('LK'/'UL' lock·unlock, 'SC'/'SA' shield-check·shield-alert, 'DC'/'DO'
//     door-closed·door-open). The glyph is decorative (accessibilityElementsHidden);
//     the title AppText carries the real meaning — the same lucide→glyph
//     substitution the sibling FlagsTable / AuditPanel ports use.
//   - `useTimelineLabels()` (web L38-69) is ported byte-for-byte: same switch
//     over ev.kind, same positive/negative ternaries, and every
//     `t('admin.security.timeline.*','English')` key + fallback preserved
//     (lock.positive/negative(+Desc), sentry.positive/negative(+Desc),
//     door.positive/negative, and the door subtitle = ev.detail).
//
// The web source pulls six modules; native-safe mapping (contract rules 4/5/7):
//   - react-i18next `useTranslation` (L1) has no native-parity module -> the
//     standard web-parity i18n shim returning the inline English fallback, so
//     the body's `t('key','English')` calls are unchanged (same approach as the
//     sibling AuditPanel / FlagsTable / FleetTelemetryHealth ports).
//   - `cn` from `@/lib/cn` (L2) was used only to compose the status-circle
//     className; React Native has no className, so it is dropped and the
//     variant→palette choice becomes a StyleSheet style-array branch.
//   - lucide-react icons (L3-10) -> the decorative glyphs described above.
//   - `GlassPanel` from `@/components/ui` (L11) -> the existing native shared
//     `components/ui/GlassPanel` primitive; `className="p-4"` -> padding 16.
//   - `TimeStamp` from `@/components/data-display` (L12) -> reused as-is from the
//     web-parity `components/data-display/TimeStamp` port (value honored; the
//     web `className` becomes an equivalent `style`).
//   - `EmptyState` from `@/components/feedback` (L13) -> the existing native
//     shared `components/feedback/EmptyState` primitive. The web source passes
//     only `message`; the native primitive requires `title` + `message`, so the
//     panel's own title (`admin.security.timeline.title`) is reused as the
//     EmptyState title — the same "reuse the section title" approach the
//     MetricSwitcherChart port uses. The source's inline no-action comment is
//     preserved.
//   - `FadeIn` from `@/components/motion` (L14) -> the web-parity
//     `components/motion` FadeIn (framer-motion entrance reproduced with RN
//     Animated); `delay={0.35}` (seconds) is passed through unchanged.
//   - `type TimelineEvent` from `./helpers` (L15) -> the web `./helpers` module
//     has no native parity surface yet, so the type is inlined here verbatim
//     (id/kind/variant/detail/timestamp) per contract rule 6.
//
// DOM -> native element mapping: `<h2 class="text-lg font-semibold text-gray-200
// mb-4">` -> AppText (role header, 18/24, weight 600, textPrimary, marginBottom
// 16); the `space-y-3 max-h-96 overflow-y-auto pr-1` scroll region -> a
// ScrollView (maxHeight 384, contentContainer gap 12 + paddingRight 4); each
// `<div class="flex items-start gap-3 rounded-lg bg-white/[0.02] p-3">` -> a row
// View; the `h-8 w-8 rounded-full` status circle -> a 32x32 centered View whose
// fill comes from ev.variant (green-500/20 -> successSurface, red-500/20 ->
// dangerSurface, gray-500/20 -> surfaceRaised); the title `<p class="text-sm
// font-medium text-gray-200">` -> AppText (14/20, weight 500, textPrimary), the
// subtitle `<p class="text-xs text-[var(--text-muted)]">` -> AppText (12/16,
// textMuted), the timestamp `text-[10px] text-[var(--text-muted)]` -> 10/14
// textMuted. No DOM-only modules, browser HTML elements, Recharts, Leaflet, or
// old web UI components are imported.

import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {TimeStamp} from '../../../../components/data-display/TimeStamp';
import {FadeIn} from '../../../../components/motion';

// ── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// `TimelineEvent` inlined from web `./helpers` (no native helpers module yet).
// Shape preserved verbatim (contract rule 6).
interface TimelineEvent {
  id: string;
  kind: 'lock' | 'sentry' | 'door';
  variant: 'positive' | 'negative' | 'neutral';
  detail: string;
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/*  Icon + text resolution based on semantic timeline data              */
/* ------------------------------------------------------------------ */

// Web `timelineIcon` returned a lucide SVG; native has no SVG icon dependency,
// so the icon collapses to a short decorative glyph chosen by kind + variant.
function timelineIconGlyph(ev: TimelineEvent): string {
  switch (ev.kind) {
    case 'lock':
      return ev.variant === 'positive' ? 'LK' : 'UL';
    case 'sentry':
      return ev.variant === 'positive' ? 'SC' : 'SA';
    case 'door':
      return ev.variant === 'positive' ? 'DC' : 'DO';
  }
}

function useTimelineLabels() {
  const {t} = useTranslation();
  return (ev: TimelineEvent): {title: string; subtitle: string} => {
    switch (ev.kind) {
      case 'lock':
        return {
          title:
            ev.variant === 'positive'
              ? t('admin.security.timeline.lock.positive', 'Vehicle Locked')
              : t('admin.security.timeline.lock.negative', 'Vehicle Unlocked'),
          subtitle:
            ev.variant === 'positive'
              ? t('admin.security.timeline.lock.positiveDesc', 'Doors secured')
              : t(
                  'admin.security.timeline.lock.negativeDesc',
                  'Doors accessible',
                ),
        };
      case 'sentry':
        return {
          title:
            ev.variant === 'positive'
              ? t(
                  'admin.security.timeline.sentry.positive',
                  'Sentry Mode Activated',
                )
              : t(
                  'admin.security.timeline.sentry.negative',
                  'Sentry Mode Deactivated',
                ),
          subtitle:
            ev.variant === 'positive'
              ? t(
                  'admin.security.timeline.sentry.positiveDesc',
                  'Camera surveillance enabled',
                )
              : t(
                  'admin.security.timeline.sentry.negativeDesc',
                  'Camera surveillance disabled',
                ),
        };
      case 'door':
        return {
          title:
            ev.variant === 'positive'
              ? t('admin.security.timeline.door.positive', 'Doors Closed')
              : t('admin.security.timeline.door.negative', 'Door Opened'),
          subtitle: ev.detail,
        };
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface EventTimelineProps {
  timelineEvents: TimelineEvent[];
}

export function EventTimeline({timelineEvents}: EventTimelineProps) {
  const {t} = useTranslation();
  const getLabels = useTimelineLabels();

  return (
    <FadeIn delay={0.35}>
      <GlassPanel style={styles.panel}>
        <AppText accessibilityRole="header" style={styles.heading}>
          {t('admin.security.timeline.title', 'Security Event Timeline')}
        </AppText>
        {timelineEvents.length > 0 ? (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}>
            {timelineEvents.map(ev => {
              const {title, subtitle} = getLabels(ev);
              return (
                <View key={ev.id} style={styles.item}>
                  <View
                    style={[
                      styles.iconCircle,
                      ev.variant === 'positive'
                        ? styles.iconPositive
                        : ev.variant === 'negative'
                        ? styles.iconNegative
                        : styles.iconNeutral,
                    ]}>
                    <AppText
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      style={[
                        styles.iconGlyph,
                        ev.variant === 'positive'
                          ? styles.iconGlyphPositive
                          : ev.variant === 'negative'
                          ? styles.iconGlyphNegative
                          : styles.iconGlyphNeutral,
                      ]}>
                      {timelineIconGlyph(ev)}
                    </AppText>
                  </View>
                  <View style={styles.body}>
                    <AppText style={styles.itemTitle}>{title}</AppText>
                    <AppText style={styles.itemSubtitle}>{subtitle}</AppText>
                  </View>
                  <TimeStamp value={ev.timestamp} style={styles.timestamp} />
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <EmptyState
            // no-action: transient empty state — surfaces when source data is missing; no specific recovery action available
            title={t('admin.security.timeline.title', 'Security Event Timeline')}
            message={t(
              'admin.security.timeline.noEvents',
              'No state changes detected in the history.',
            )}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

export default EventTimeline;

const styles = StyleSheet.create({
  panel: {
    padding: 16, // p-4
  },
  heading: {
    color: colors.textPrimary, // text-gray-200
    fontSize: 18, // text-lg
    fontWeight: '600', // font-semibold
    lineHeight: 24,
    marginBottom: 16, // mb-4
  },
  list: {
    maxHeight: 384, // max-h-96
  },
  listContent: {
    gap: 12, // space-y-3
    paddingRight: 4, // pr-1
  },
  item: {
    alignItems: 'flex-start', // items-start
    backgroundColor: 'rgba(255, 255, 255, 0.02)', // bg-white/[0.02]
    borderRadius: 8, // rounded-lg
    flexDirection: 'row',
    gap: 12, // gap-3
    padding: 12, // p-3
  },
  iconCircle: {
    alignItems: 'center',
    borderRadius: 16, // rounded-full (h-8 w-8)
    flexShrink: 0, // shrink-0
    height: 32,
    justifyContent: 'center',
    marginTop: 2, // mt-0.5
    width: 32,
  },
  iconPositive: {
    backgroundColor: colors.successSurface, // bg-green-500/20
  },
  iconNegative: {
    backgroundColor: colors.dangerSurface, // bg-red-500/20
  },
  iconNeutral: {
    backgroundColor: colors.surfaceRaised, // bg-gray-500/20
  },
  iconGlyph: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    lineHeight: 16,
  },
  iconGlyphPositive: {
    color: colors.success, // text-green-400
  },
  iconGlyphNegative: {
    color: colors.danger, // text-red-400
  },
  iconGlyphNeutral: {
    color: colors.textMuted, // text-[var(--text-muted)]
  },
  body: {
    flex: 1, // flex-1 min-w-0
    flexShrink: 1,
  },
  itemTitle: {
    color: colors.textPrimary, // text-gray-200
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
    lineHeight: 20,
  },
  itemSubtitle: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  timestamp: {
    color: colors.textMuted, // text-[var(--text-muted)]
    flexShrink: 0, // shrink-0
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
});
