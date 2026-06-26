// Native parity port of
// web/src/features/admin/components/devtools/tools/ColorConverter.tsx.
//
// The web tool is one of the 15 admin "Developer Tools" client utilities: it
// takes a 6-digit hex color, parses it into r/g/b, derives h/s/l via the shared
// ./helpers rgbToHsl, and shows a live swatch plus RGB / HSL / HEX value cards
// (each with a clipboard CopyButton). All computation is client-side, so the
// behavior ports faithfully to React Native.
//
// Native adaptations vs. the web source:
//   - react-i18next `useTranslation().t` -> a native-safe `t(key, fallback?)`
//     shim. The web calls `t('Color Converter')` / `t('Color Converter Desc')`
//     / `t('Hex Color')` with the English string AS the key (no fallback), so
//     the shim returns the key verbatim, preserving the rendered text + i18n
//     keys exactly.
//   - lucide-react `Palette` icon (ToolCard `icon` + the in-Input adornment) is
//     browser-only; ToolCard's accent chip stands in for it (purple accent), so
//     the icon prop is dropped. The visual intent (purple-accented card) is kept.
//   - `@/components/ui` `Input` -> a labelled React Native `TextInput`.
//   - `@/components/ui` `CopyButton` is browser-only (navigator.clipboard); no
//     clipboard package is wired into the parity tree, so the buttons are
//     dropped. The value text is rendered `selectable` so it can still be
//     long-pressed to copy — preserving the copy-the-value intent.
//   - `../ToolCard` -> the canonical native `ToolCard` re-exported from the
//     devtools barrel ('..').
//   - `../helpers` `rgbToHsl` -> inlined verbatim below (this tool is its only
//     consumer in the parity tree and no native helpers module exists yet).
//   - The `style={{ backgroundColor: hex }}` swatch maps to a dynamic native
//     style; `<div>` wrappers map to `<View>`; Tailwind classes map to
//     StyleSheet token styles.

import {useMemo, useState} from 'react';
import {StyleSheet, TextInput, View} from 'react-native';

import {AppText} from '../../../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../../../theme/tokens';
import {ToolCard} from '..';

/* ─── native-safe i18n shim ───────────────────────────────────────────────
   The web tool's keys ARE the English strings, so returning the key (or an
   explicit fallback when provided) preserves both the keys and the output. */

function t(key: string, fallback?: string): string {
  return fallback ?? key;
}

/* ─── rgbToHsl (faithful port of ../helpers rgbToHsl) ─────────────────────── */

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;
  const max = Math.max(r1, g1, b1);
  const min = Math.min(r1, g1, b1);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, Math.round(l * 100)];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r1) {
    h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6;
  } else if (max === g1) {
    h = ((b1 - r1) / d + 2) / 6;
  } else {
    h = ((r1 - g1) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
}

export function ColorConverterTool() {
  const [hex, setHex] = useState('#3b82f6');

  const parsed = useMemo<ParsedColor | null>(() => {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) {
      return null;
    }
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      return null;
    }
    const [h, s, l] = rgbToHsl(r, g, b);
    return {r, g, b, h, s, l};
  }, [hex]);

  return (
    <ToolCard
      color="purple"
      title={t('Color Converter')}
      description={t('Color Converter Desc')}>
      <View style={styles.body}>
        <View style={styles.inputRow}>
          <View style={styles.inputField}>
            <AppText variant="caption" tone="secondary">
              {t('Hex Color')}
            </AppText>
            <TextInput
              value={hex}
              onChangeText={setHex}
              placeholder="#3b82f6"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel={t('Hex Color')}
            />
          </View>
          <View style={[styles.swatch, {backgroundColor: hex}]} />
        </View>
        {parsed ? (
          <View style={styles.grid}>
            <View style={styles.resultCard}>
              <AppText variant="caption" tone="secondary">
                RGB
              </AppText>
              <AppText
                variant="body"
                tone="primary"
                selectable
                style={styles.mono}>
                {`rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`}
              </AppText>
            </View>
            <View style={styles.resultCard}>
              <AppText variant="caption" tone="secondary">
                HSL
              </AppText>
              <AppText
                variant="body"
                tone="primary"
                selectable
                style={styles.mono}>
                {`hsl(${parsed.h}, ${parsed.s}%, ${parsed.l}%)`}
              </AppText>
            </View>
            <View style={styles.resultCard}>
              <AppText variant="caption" tone="secondary">
                HEX
              </AppText>
              <AppText
                variant="body"
                tone="primary"
                selectable
                style={styles.mono}>
                {hex}
              </AppText>
            </View>
          </View>
        ) : null}
      </View>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  inputField: {
    flex: 1,
    gap: spacing.xs,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    fontSize: typography.body,
  },
  swatch: {
    height: 40,
    width: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  resultCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 120,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  mono: {
    fontFamily: 'monospace',
  },
});
