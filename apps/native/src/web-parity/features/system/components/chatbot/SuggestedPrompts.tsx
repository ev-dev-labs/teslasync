// Native parity port of
// web/src/features/system/components/chatbot/SuggestedPrompts.tsx.
//
// Empty-state chip strip shown above the chat input on a fresh conversation: a
// compact, centered, wrapping row of suggestion chips. The vendor-agnostic data
// half is ported verbatim — the `ChatSuggestion` interface (i18nKey +
// defaultValue) and `getChatSuggestions()` returning the same four static
// suggestions in the same order, kept as a const factory so it can later be
// swapped for a backend-fed endpoint without touching the component shape
// (web L5-37). Only the DOM / icon / i18n presentation layer is re-expressed
// with React Native primitives:
//
//   - react-i18next `useTranslation` (web L1, L54) -> inlined
//     `useNativeTranslationFallback()` returning the web English fallback string
//     verbatim (the native parity tree has no i18n runtime), matching the
//     DatePresetChips / PinButton / ImpersonationBanner ports. Every key +
//     default is preserved: 'chatbot.aria.suggestions'/'Suggested prompts'
//     (web L60) and each suggestion's i18nKey + defaultValue resolved via
//     t(s.i18nKey, s.defaultValue) at render (web L63).
//   - The shared web `<Button variant="ghost" size="sm">` chip (web L3, L66-74)
//     becomes an inline Pressable + AppText chip (the DatePresetChips
//     convention) — native AppButton exposes neither a `size` scale nor the
//     ghost / rounded-full / bordered chip surface, so it is intentionally not
//     reused and no web UI/DOM module is imported. The button's gap-2 icon+label
//     row, rounded-full pill, subtle border, and px-3 / h-8 (size sm) padding are
//     reproduced in StyleSheet; `onClick={() => onPick(text)}` maps 1:1 to
//     `onPress` (web L69).
//   - lucide-react `Sparkles` (web L2, L70) has no native icon module. Following
//     the PinButton precedent (lucide `Pin`/`PinOff` -> a single tintable `★`
//     AppText glyph), the inline `h-3.5 w-3.5` Sparkles maps to a tintable `✦`
//     (U+2726) AppText glyph sized to 14px — a monochrome four-pointed star that
//     renders/tints reliably across iOS/Android/Windows/macOS (color emoji like
//     `✨` are not tintable). It carries the same tint as the label and is
//     `importantForAccessibility="no"` so the chip's accessible name stays the
//     suggestion text.
//   - The web hover refinements `hover:border-purple-500/30 hover:text-purple-300`
//     (web L71) — purple is not in the native theme — become a `pressed`
//     highlight (the established RN substitute for :hover on touch surfaces):
//     the chip border -> purple-500/30 and the icon + label -> purple-300 using
//     the hex-literal convention used across the parity tree (cf. PinButton's
//     amber literals). The ghost `hover:bg` lift maps to a pressed surface fill.
//   - The semantic list `<ul aria-label=…>` / per-item `<li>` wrappers (web
//     L58-65, L75) collapse: the `<ul>` -> a View carrying the same accessible
//     group name (accessibilityLabel) plus the row layout (flex flex-wrap gap-2
//     justify-center max-w-2xl mx-auto -> flexDirection row / flexWrap wrap /
//     gap / justifyContent center / alignSelf center / maxWidth 672); each
//     unstyled `<li>` (list-none p-0 m-0) collapses into its Pressable chip,
//     keyed by s.i18nKey (web L65).
//   - `SuggestedPromptsProps` (web L39-46, onPick) stays a local, non-exported
//     interface exactly as in web (web does not export it); the note that the
//     page fills + focuses the input WITHOUT auto-submitting is preserved.

import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

/**
 * Static, in-process source of suggestion chips shown on an empty
 * conversation. Defined as a const today so it can be replaced with a
 * backend-fed endpoint later without touching the component shape.
 *
 * Each entry has an `i18nKey` + `defaultValue` so translations are
 * drop-in via the existing i18n pipeline.
 */
export interface ChatSuggestion {
  i18nKey: string;
  defaultValue: string;
}

export function getChatSuggestions(): ChatSuggestion[] {
  return [
    {
      i18nKey: 'chatbot.suggestion.fleetYesterday',
      defaultValue: 'What did my fleet do yesterday?',
    },
    {
      i18nKey: 'chatbot.suggestion.chargingCost30d',
      defaultValue: 'Charging cost last 30 days',
    },
    {
      i18nKey: 'chatbot.suggestion.socDropping',
      defaultValue: 'Why is my SoC dropping faster this week?',
    },
    {
      i18nKey: 'chatbot.suggestion.efficientDrive',
      defaultValue: 'Show me the most efficient drive this month',
    },
  ];
}

interface SuggestedPromptsProps {
  /**
   * Called with the suggestion text when a chip is pressed. The page
   * fills the input and focuses it but does NOT auto-submit, so the user
   * can edit the prompt before sending.
   */
  onPick: (text: string) => void;
}

function useNativeTranslationFallback(): (
  key: string,
  fallback: string,
) => string {
  return React.useCallback((_key: string, fallback: string) => fallback, []);
}

// Exact web purple shades. No purple token exists in the native theme, so the
// hex-literal convention used across the parity tree maps each Tailwind shade
// verbatim (cf. PinButton's amber literals).
const PURPLE_300 = '#d8b4fe'; // hover:text-purple-300
const PURPLE_BORDER = 'rgba(168, 85, 247, 0.3)'; // hover:border-purple-500/30

/**
 * Empty-state chip strip shown above the input on a fresh conversation.
 * Intentionally compact (4 chips, single row that wraps on narrow widths)
 * so it doesn't dominate the message area.
 */
export function SuggestedPrompts({onPick}: SuggestedPromptsProps) {
  const t = useNativeTranslationFallback();
  const suggestions = getChatSuggestions();

  return (
    <View
      accessibilityLabel={t('chatbot.aria.suggestions', 'Suggested prompts')}
      style={styles.row}>
      {suggestions.map(s => {
        const text = t(s.i18nKey, s.defaultValue);
        return (
          <Pressable
            key={s.i18nKey}
            accessibilityLabel={text}
            accessibilityRole="button"
            onPress={() => onPick(text)}
            style={({pressed}) => [styles.chip, pressed && styles.chipPressed]}>
            {({pressed}) => (
              <>
                <AppText
                  importantForAccessibility="no"
                  style={[
                    styles.icon,
                    pressed ? styles.textPressed : styles.textResting,
                  ]}>
                  ✦
                </AppText>
                <AppText
                  style={[
                    styles.label,
                    pressed ? styles.textPressed : styles.textResting,
                  ]}>
                  {text}
                </AppText>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm, // gap-2
    justifyContent: 'center',
    maxWidth: 672, // max-w-2xl
  },
  chip: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: colors.border, // border-[var(--border-subtle)]
    borderRadius: 999, // rounded-full
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm, // gap-2
    minHeight: 32, // h-8
    paddingHorizontal: 12, // px-3
    paddingVertical: 6,
  },
  chipPressed: {
    backgroundColor: colors.surfaceRaised, // ghost hover:bg lift
    borderColor: PURPLE_BORDER, // hover:border-purple-500/30
  },
  icon: {
    fontSize: 14, // h-3.5 w-3.5
    lineHeight: 16,
  },
  label: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  textResting: {
    color: colors.textPrimary,
  },
  textPressed: {
    color: PURPLE_300,
  },
});
