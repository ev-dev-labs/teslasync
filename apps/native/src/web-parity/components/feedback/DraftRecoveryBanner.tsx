// Native parity port of web/src/components/feedback/DraftRecoveryBanner.tsx.
//
// Reassuring inline notice rendered at the top of an editor when the form was
// hydrated from `useFormDraft`. The web source composed the shared web
// AlertBanner (variant="info"), a lucide-react <Info /> glyph, two web UI
// <Button> affordances, react-i18next, and the @/lib/dateFormat
// formatRelativeTime helper on a stack of <div>/<span> elements with Tailwind
// classes.
//
// This port reproduces the same behaviour and visual intent with React Native
// View/Pressable/AppText primitives, the SemanticIcon glyph, the design
// tokens, and self-contained native ports of the info-variant banner chrome,
// the relative-time formatter, and the i18n fallback/interpolation -- no DOM,
// no lucide-react, no recharts/leaflet, and no web UI components. AlertBanner
// and the web UI Button have no native parity port yet, so their relevant
// surface is recreated inline here (mirroring how _ErrorState recreates its
// card chrome and ConfirmDialog recreates its buttons).

import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

type TranslationVars = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

export interface DraftRecoveryBannerProps {
  /** Whether the editor was hydrated from a stored draft. */
  hasDraft: boolean;
  /** When the draft was last persisted. Used for the "from N minutes ago" copy. */
  draftSavedAt: Date | null;
  /**
   * "Use draft" handler -- present-only banner, the draft has already been
   * applied to the editor on hydration. Most callers can pass a no-op or
   * leave it undefined (the banner handles dismissal internally).
   */
  onRestore?: () => void;
  /** "Discard draft" handler -- caller should call discardDraft() from the form-draft hook. */
  onDiscard: () => void;
  /** Customize the noun in the banner copy (e.g. "rule", "automation", "settings"). */
  itemNoun?: string;
}

// neon-cyan (#00f0ff = rgb(0, 240, 255)) is the web AlertBanner "info" variant
// hue. The Tailwind ramp used border-neon-cyan/20, bg-neon-cyan/5, the
// icon/title at full neon-cyan, and the body text at neon-cyan/80. The shared
// token set exposes a cyan accent (#35d5ff) but not these exact neon-cyan alpha
// stops, so they are recreated here from the neon-cyan channels.
const NEON_CYAN_RGB = '0, 240, 255';
const BANNER_BG = `rgba(${NEON_CYAN_RGB}, 0.05)`;
const BANNER_BORDER = `rgba(${NEON_CYAN_RGB}, 0.2)`;
const BODY_TEXT = `rgba(${NEON_CYAN_RGB}, 0.8)`;

/**
 * Faithful native port of `formatRelativeTime` from web/src/lib/dateFormat.ts
 * (the only formatter this component used). Returns the universal "—"
 * placeholder for nullish input, "Just now" / "{n}m ago" / "{n}h ago" for
 * recent timestamps, and an absolute "Mon D, HH:MM" label beyond 24h. The web
 * helper accepted optional locale/timezone overrides; this banner never passed
 * them, so the browser-default behaviour is preserved verbatim.
 */
function formatRelativeTime(value: Date | string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
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
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function interpolate(template: string, vars: TranslationVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

/**
 * The web component read `t` from react-i18next. Native parity has no i18n
 * runtime wired yet, so this returns the English fallback string, applying the
 * same `{{var}}` interpolation react-i18next would (preserving i18n intent).
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, vars) => {
    if (!vars) {
      return fallback;
    }
    return interpolate(fallback, vars);
  }, []);
}

/**
 * DraftRecoveryBanner -- reassuring inline notice rendered at the top of an
 * editor when the form was hydrated from `useFormDraft`.
 *
 * Tells the user "we restored your unsaved work from N minutes ago" and offers
 * two affordances:
 *  1. **Use draft** -- dismisses the banner. The draft is already applied (that
 *     is the point of hydration on mount), so this is a UX-only acknowledgement.
 *  2. **Discard draft** -- calls `onDiscard` so the parent can reset the editor
 *     to a clean baseline and clear the stored draft.
 *
 * Renders nothing when `hasDraft` is false or the user has dismissed the banner
 * via either action.
 */
export function DraftRecoveryBanner({
  hasDraft,
  draftSavedAt,
  onRestore,
  onDiscard,
  itemNoun,
}: DraftRecoveryBannerProps) {
  const t = useNativeTranslationFallback();
  const [dismissed, setDismissed] = useState(false);

  if (!hasDraft || dismissed) {
    return null;
  }

  const when = draftSavedAt
    ? formatRelativeTime(draftSavedAt)
    : t('draft.unknownTime', 'a moment ago');

  const message = itemNoun
    ? t('draft.restoredItem', '{{noun}} draft restored from {{when}}.', {
        noun: itemNoun,
        when,
      })
    : t('draft.restored', 'Draft restored from {{when}}.', {when});

  const handleRestore = () => {
    setDismissed(true);
    onRestore?.();
  };

  const handleDiscard = () => {
    setDismissed(true);
    onDiscard();
  };

  return (
    <View
      accessibilityLiveRegion="polite"
      style={styles.banner}
      testID="draft-recovery-banner">
      <View pointerEvents="none" style={styles.icon}>
        <SemanticIcon decorative name="info" size="sm" />
      </View>
      <View style={styles.body}>
        <View style={styles.content}>
          <AppText style={styles.message}>{message}</AppText>
          <View style={styles.actions}>
            <BannerButton
              label={t('draft.useDraft', 'Use draft')}
              onPress={handleRestore}
              variant="ghost"
            />
            <BannerButton
              label={t('draft.discardDraft', 'Discard draft')}
              onPress={handleDiscard}
              variant="secondary"
            />
          </View>
        </View>
      </View>
    </View>
  );
}

DraftRecoveryBanner.displayName = 'DraftRecoveryBanner';

/**
 * Inline recreation of the two web UI <Button size="sm"> affordances used by
 * the banner. "ghost" mirrors the transparent web ghost variant; "secondary"
 * mirrors the muted gray-filled secondary variant. No native Button parity port
 * exists yet, so the small surface is recreated here like ConfirmDialog's
 * DialogAction.
 */
function BannerButton({
  label,
  onPress,
  variant,
}: {
  label: string;
  onPress: () => void;
  variant: 'ghost' | 'secondary';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'ghost' ? styles.buttonGhost : styles.buttonSecondary,
        pressed && styles.buttonPressed,
      ]}>
      <AppText
        style={
          variant === 'ghost' ? styles.buttonGhostText : styles.buttonSecondaryText
        }
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.sm,
  },
  banner: {
    alignItems: 'flex-start',
    backgroundColor: BANNER_BG,
    borderColor: BANNER_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonGhostText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
  },
  buttonSecondaryText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  icon: {
    marginTop: 2,
  },
  message: {
    color: BODY_TEXT,
    flex: 1,
    fontSize: typography.caption,
    minWidth: 0,
  },
});
