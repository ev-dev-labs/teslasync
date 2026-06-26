// Native parity port of
// web/src/features/system/components/CommandSearch.tsx.
//
// A controlled search box for the command palette: a leading search icon plus a
// text field that lifts every keystroke to the parent through onChange(value).
// The `value`/`onChange` prop contract, the i18n key + English fallback for the
// placeholder, and the web Input's visual intent (faint white fill, hairline
// white border, rounded-md corners, primary text, muted placeholder, muted
// leading icon) are all preserved.
//
// Native adaptations vs. the web source (behaviour / keys kept):
//   - react-i18next `useTranslation` (web L1) -> the inline native-safe
//     `useNativeTranslationFallback` t(key, fallback) hook (there is no i18n
//     runtime in the parity tree); the placeholder key + English fallback are
//     copied verbatim.
//   - `@/components/ui` Input (web L2) -> a React Native <TextInput> inside a
//     bordered row <View>. The web Input's md sizing (px-3 py-2 text-sm), its
//     rounded-md border + surface fill, and this caller's className overrides
//     (bg-white/[0.03], border-white/[0.06], text primary, placeholder muted)
//     are reproduced with StyleSheet + theme tokens. The web onChange handler
//     `(e) => onChange(e.target.value)` (web L16) maps to RN `onChangeText`,
//     which already delivers the raw string value.
//   - lucide-react `Search` (web L3, L18 `<Search className="h-4 w-4" />`) ->
//     the canonical SemanticIcon 'search' glyph rendered as muted inline text
//     in the Input's leading icon slot. The web icon was absolutely positioned
//     left with a -translate-y centre; the native row simply places it to the
//     left of the field — same visual intent. The glyph is decorative and
//     hidden from assistive tech (the field itself carries the label).
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback} from 'react';
import {StyleSheet, TextInput, View} from 'react-native';

import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

// Web lucide <Search/> -> canonical native SemanticIcon glyph (rendered as text).
const SEARCH_GLYPH = getSemanticIconDefinition('search').glyph;

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

interface CommandSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function CommandSearch({value, onChange}: CommandSearchProps) {
  const t = useNativeTranslationFallback();
  const placeholder = t('commands.search.placeholder', 'Search commands...');

  return (
    <View style={styles.container}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.icon}
        variant="caption"
        weight="bold">
        {SEARCH_GLYPH}
      </AppText>
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        style={styles.input}
        testID="command-search-input"
        value={value}
      />
    </View>
  );
}

CommandSearch.displayName = 'CommandSearch';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    width: '100%',
  },
  icon: {
    color: colors.textMuted,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
});
