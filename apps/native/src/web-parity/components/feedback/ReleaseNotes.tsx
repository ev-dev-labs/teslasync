// Native parity port of web/src/components/feedback/ReleaseNotes.tsx.
//
// Compact, collapsible release-notes accordion. Consumes the byte-identical
// native copy of the auto-generated changelog data
// (apps/native/src/web-parity/generated/changelog.ts) so the list stays in
// sync with the in-app "what's new" modal — exactly as the web component
// imports @/generated/changelog. The default `limit` of 3 preserves the
// compact footprint the web card uses when embedded in a sidebar/about page.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next's t(key, fallback) becomes a local fallback that renders
//     the English fallback copy, preserving visual + i18n intent without
//     bundling the web i18n runtime (neither call site interpolates options).
//   - The web ../ui/GlassPanel and ../ui/Badge are replaced by the existing
//     native GlassPanel and an inline badge chip whose BADGE_PALETTE mirrors
//     the web success/info/warning Badge variants onto native theme tokens
//     (info -> accent, matching the sibling ChangelogModal port).
//   - lucide-react Gift / ChevronUp / ChevronDown glyphs become monochrome BMP
//     markers (Gift -> '\u2605' star tinted by the badge palette; chevrons ->
//     '\u25b4' up / '\u25be' down), matching the OnboardingWizard/ErrorBoundary
//     glyph precedent. The icons stay aria-hidden via the native accessibility
//     hide props since the Pressable already announces the expanded state.
//   - cn() class merging and Tailwind/CSS-var classes become React Native
//     StyleSheet styles + style arrays with native theme tokens.

import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../theme/tokens';
import {
  CHANGELOG,
  type ChangelogBadge,
  type ChangelogChangeType,
  type ChangelogEntry,
} from '../../generated/changelog';

// ── i18n fallback ────────────────────────────────────────────────────────────
// The web component reads copy through react-i18next's t(key, fallback). Native
// renders the English fallback directly so visual + i18n intent are preserved
// without bundling the web i18n runtime.

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

type BadgeVariant = 'success' | 'info' | 'warning';

const BADGE_VARIANT: Record<ChangelogBadge, BadgeVariant> = {
  latest: 'success',
  stable: 'info',
  beta: 'warning',
};

const BADGE_KEY: Record<ChangelogBadge, string> = {
  latest: 'changelog.badges.latest',
  stable: 'changelog.badges.stable',
  beta: 'changelog.badges.beta',
};

const BADGE_FALLBACK: Record<ChangelogBadge, string> = {
  latest: 'Latest',
  stable: 'Stable',
  beta: 'Beta',
};

type BadgePalette = {background: string; border: string; text: string};

// Mirrors the web Badge variants (success=green, info=blue, warning=yellow)
// onto the native palette. The native set has no distinct blue token, so info
// maps to accent (cyan), matching the sibling ChangelogModal parity port.
const BADGE_PALETTE: Record<BadgeVariant, BadgePalette> = {
  success: {
    background: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  info: {
    background: colors.accentSoft,
    border: colors.borderAccent,
    text: colors.accent,
  },
  warning: {
    background: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
};

// Web ICON_TINT (text-emerald-300 / text-cyan-300 / text-amber-300) toned onto
// native tokens.
const ICON_TINT: Record<ChangelogBadge, string> = {
  latest: colors.success,
  stable: colors.accent,
  beta: colors.warning,
};

// Web DOT_TINT (bg-{emerald,cyan,amber,rose,purple,rose}-400/60) toned onto
// native tokens.
const DOT_TINT: Record<ChangelogChangeType, string> = {
  added: colors.success,
  changed: colors.accent,
  fixed: colors.warning,
  removed: colors.danger,
  deprecated: colors.violet,
  security: colors.danger,
};

interface Props {
  /**
   * Cap the number of releases rendered (newest-first). Defaults to 3 to
   * preserve the previous component's compact footprint when embedded as a
   * sidebar/about-page card.
   */
  limit?: number;
}

export default function ReleaseNotes({limit = 3}: Props) {
  const t = useNativeTranslationFallback();
  const releases: readonly ChangelogEntry[] = CHANGELOG.slice(0, limit);
  const [expanded, setExpanded] = useState<string | null>(
    releases[0]?.version ?? null,
  );

  return (
    <View style={styles.list}>
      {releases.map(release => {
        const isExpanded = expanded === release.version;
        const badgePalette = BADGE_PALETTE[BADGE_VARIANT[release.badge]];
        return (
          <GlassPanel key={release.version} style={styles.panel}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{expanded: isExpanded}}
              onPress={() => setExpanded(isExpanded ? null : release.version)}
              style={({pressed}) => [
                styles.header,
                pressed && styles.headerPressed,
              ]}
              testID={`release-notes-${release.version}`}>
              <View style={styles.headerLeft}>
                <AppText
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.giftGlyph, {color: ICON_TINT[release.badge]}]}>
                  {'\u2605'}
                </AppText>
                <AppText style={styles.version} weight="semibold">
                  v{release.version}
                </AppText>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: badgePalette.background,
                      borderColor: badgePalette.border,
                    },
                  ]}>
                  <AppText
                    style={[styles.badgeText, {color: badgePalette.text}]}
                    variant="caption"
                    weight="semibold">
                    {t(BADGE_KEY[release.badge], BADGE_FALLBACK[release.badge])}
                  </AppText>
                </View>
                <AppText style={styles.date} tone="muted">
                  {release.date}
                </AppText>
              </View>
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.chevron}
                tone="muted">
                {isExpanded ? '\u25b4' : '\u25be'}
              </AppText>
            </Pressable>

            {isExpanded ? (
              <View style={styles.body}>
                <AppText
                  style={styles.heading}
                  variant="caption"
                  weight="semibold">
                  {t('changelog.releaseNotes.heading', "What's New")}
                </AppText>
                <View style={styles.changeList}>
                  {release.changes.map((item, i) => (
                    <View key={i} style={styles.changeRow}>
                      <View
                        style={[
                          styles.changeDot,
                          {backgroundColor: DOT_TINT[item.type]},
                        ]}
                      />
                      <AppText style={styles.changeText} tone="secondary">
                        {item.text}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </GlassPanel>
        );
      })}
    </View>
  );
}

ReleaseNotes.displayName = 'ReleaseNotes';

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  body: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  changeDot: {
    borderRadius: 999,
    flexShrink: 0,
    height: 6,
    marginTop: 6,
    width: 6,
  },
  changeList: {
    gap: 6,
  },
  changeRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  changeText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  chevron: {
    fontSize: 14,
  },
  date: {
    fontSize: typography.caption,
  },
  giftGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  headerPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  heading: {
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  list: {
    gap: spacing.md,
  },
  panel: {
    overflow: 'hidden',
  },
  version: {
    color: colors.textPrimary,
    fontSize: 14,
  },
});
