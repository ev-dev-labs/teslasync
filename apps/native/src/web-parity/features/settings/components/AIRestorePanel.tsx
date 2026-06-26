// Native parity port of web/src/features/settings/components/AIRestorePanel.tsx.
//
// Restore-previous-selection panel (web source L1-16). Surfaced ONLY when:
//   1. The user is currently in a non-off mode (otherwise there is no point
//      offering a restore — they need to enable AI first).
//   2. The server returned a non-empty `ai_features_archived` snapshot from a
//      prior mode→off transition.
//   3. The user has not declined this prompt in the current session.
// Per ADR-015 §I7, restore is **never silent**: Confirm applies the archived
// selection AND issues a save (web `onConfirm`); Decline simply dismisses for
// the session (web `onDecline`). The mounting feature owns those side effects;
// this component is the presentational surface only, so the public contract
// (`archived` / `onConfirm` / `onDecline`) is preserved verbatim.
//
// Native-safe translation of every browser-only dependency (documented in the
// .parity.json sidecar):
//   - react-i18next `useTranslation('settings')` (source L18,53): the native app
//     has no i18next runtime, so this uses the established native-safe
//     `useNativeTranslationFallback` shim — `t(key, default, params?)` returns
//     the English default with `{{token}}` interpolation. The 'settings'
//     namespace and the `ai.settings.*` key strings carry no behaviour on native
//     (no bundle to resolve), so they collapse to their default text exactly as
//     the web fallbacks would render before a translation loads.
//   - lucide-react `Sparkles` (source L19,66): RN has no lucide; rendered as a
//     decorative AppText sparkles glyph (\u2728) tinted purple-300 to match the
//     web `text-purple-300` icon, hidden from accessibility (web `aria-hidden`).
//   - `@/components/ui` `Button` (source L20): replaced by a local Pressable +
//     AppText `ActionButton` preserving the ghost/primary variants and the
//     `data-testid` hooks (→ `testID`). `Caption`/`Subhead` (source L20) come
//     from the native Typography parity module (same role styling/intent).
//   - `@/ai/features` `AI_FEATURES`/`isKnownAiFeature` (source L21): imported
//     from the native parity mirror of the generated AI registry.
//   - Semantic HTML: `<section role="alert" aria-live="polite">` (source L59-61)
//     → `<View accessibilityRole="alert" accessibilityLiveRegion="polite">`; the
//     `<ul>/<li>` archived-feature listing (source L80-86) → a View of bulleted
//     AppText rows. The `data-testid` attributes (source L63,94,102) become
//     `testID` so native tests target the same nodes.

import React, {useRef} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AI_FEATURES, isKnownAiFeature} from '../../../ai/features';
import {Caption, Subhead} from '../../../components/ui/Typography';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

// Resolved purple accents behind the web Tailwind classes (source L62,66,81):
// purple-400/40 border, purple-500/5 surface, purple-300 icon tint.
const PURPLE_BORDER = 'rgba(192, 132, 252, 0.4)'; // border-purple-400/40
const PURPLE_SURFACE = 'rgba(168, 85, 247, 0.05)'; // bg-purple-500/5
const PURPLE_ICON = '#d8b4fe'; // text-purple-300

// ── native translation fallback (native-safe port of react-i18next, source L18,53) ──
type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  defaultValue: string,
  params?: NativeTParams,
) => string;

function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, defaultValue, params) =>
    interpolate(defaultValue, params),
  ).current;
}

interface Props {
  archived: Record<string, boolean>;
  onConfirm: () => void;
  onDecline: () => void;
}

/**
 * Renders a comma-separated preview of the archived feature names so the user
 * can decide WITHOUT having to mentally diff against the current toggle list.
 * Unknown IDs (a feature was removed between archive and restore) fall back to
 * the raw ID so the listing is never blank. Ported verbatim from web source
 * L36-50, including the `translate(id, fallback)` indirection.
 */
function previewLabels(
  archived: Record<string, boolean>,
  translate: (id: string, fallback: string) => string,
): string[] {
  const out: string[] = [];
  for (const [id, value] of Object.entries(archived)) {
    if (!value) {
      continue;
    }
    if (isKnownAiFeature(id)) {
      out.push(translate(id, AI_FEATURES[id].name));
    } else {
      out.push(id);
    }
  }
  return out;
}

export function AIRestorePanel({archived, onConfirm, onDecline}: Props) {
  const t = useNativeTranslationFallback();
  const labels = previewLabels(archived, (id, fallback) =>
    t(`ai.settings.feature.${id}.label`, fallback),
  );

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={styles.panel}
      testID="ai-restore-panel">
      <View style={styles.row}>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.icon}>
          {'\u2728'}
        </AppText>
        <View style={styles.content}>
          <Subhead>
            {t(
              'ai.settings.archive.title',
              'Restore previous Helix selection?',
            )}
          </Subhead>
          <Caption>
            {t(
              'ai.settings.archive.description',
              'You previously had these features enabled. Re-enable them now?',
            )}
          </Caption>
          {labels.length > 0 ? (
            <View style={styles.list}>
              {labels.map(label => (
                <AppText key={label} style={styles.listItem} variant="caption">
                  {`\u2022  ${label}`}
                </AppText>
              ))}
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        <ActionButton
          label={t('ai.settings.archive.decline', 'No thanks')}
          onPress={onDecline}
          testID="ai-restore-decline"
          variant="ghost"
        />
        <ActionButton
          label={t('ai.settings.archive.restore', 'Restore selection')}
          onPress={onConfirm}
          testID="ai-restore-confirm"
          variant="primary"
        />
      </View>
    </View>
  );
}

// Native analog of the web `@/components/ui` Button (source L20,90-105): the
// ghost (decline) + primary (restore) variants and the `data-testid` hooks.
function ActionButton({
  label,
  onPress,
  testID,
  variant,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={
          variant === 'primary'
            ? styles.primaryButtonText
            : styles.ghostButtonText
        }
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  ghostButton: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
  icon: {
    color: PURPLE_ICON,
    fontSize: 16,
    lineHeight: 18,
    marginTop: 2,
  },
  list: {
    gap: 2,
    marginTop: spacing.sm,
  },
  listItem: {
    color: colors.textSecondary,
  },
  panel: {
    backgroundColor: PURPLE_SURFACE,
    borderColor: PURPLE_BORDER,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
