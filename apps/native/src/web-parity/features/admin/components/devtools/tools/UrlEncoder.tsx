// Native parity port of
// web/src/features/admin/components/devtools/tools/UrlEncoder.tsx.
//
// The web source is a self-contained dev-tools card: pick "Encode" or "Decode",
// type into a textarea, and a derived cyan monospace readout shows the
// `encodeURIComponent` / `decodeURIComponent` result (or `t('Invalid Input')`
// when decoding malformed percent-encoding throws). It composes the same web
// pieces the sibling `HashCalculator` tool does — `ToolCard` (a GlassPanel with
// a coloured icon header), the shared `Button` / `Textarea` inputs, the shared
// `CopyButton`, and the lucide `Link` glyph — plus react-i18next for its labels.
//
// Mirroring the sibling `HashCalculator` / `BackendTool` native ports (which
// inline the dev-tools pieces they need because the native devtools tree ships
// no shared `ToolCard` / `Button` / `CopyButton`), this self-contained port
// rebuilds each dependency with React Native primitives and existing native
// tokens:
//   * `encodeURIComponent` / `decodeURIComponent` are standard ECMAScript
//     globals (not browser-only) — present in the React Native runtime
//     (Hermes / JSC) and in the Jest/Node test env — so the encode/decode
//     `useMemo`, including its `try/catch` returning `t('Invalid Input')` on a
//     malformed-input `URIError`, is ported verbatim. No browser-only behaviour
//     is involved here, so no "unavailable" stub is needed for the core logic.
//   * `ToolCard` becomes a native `ToolCardView` (a `GlassPanel` with a tinted
//     icon box rendered through the shared native `Icon` wrapper; the web
//     ICON_COLOR_MAP neon classes map to the matching token colour stops,
//     defaulting to cyan exactly like the web `?? ICON_COLOR_MAP.cyan`).
//   * The lucide `Link` glyph becomes `LinkGlyph`, an `IconComponentType`-shaped
//     component rendering the repo's canonical `link` SemanticIcon glyph (`LN`,
//     accent/cyan) — the established native stand-in for lucide `Link`, the same
//     mapping the sibling `ReferenceLinksSection` port uses. No DOM/lucide
//     `<svg>` is imported.
//   * The web `Textarea` (sm, 2 rows) becomes a native multiline `TextInput`.
//   * The two web primary/ghost `Button`s become native `ModeButton` Pressables
//     that fill with the accent colour when active and stay transparent
//     (hairline-bordered) when not, matching `variant={mode === 'encode' ?
//     'primary' : 'ghost'}`.
//   * The shared `CopyButton` maps to a clipboard control gated behind a
//     registerable writer — native parity ships no clipboard module (no
//     `@react-native-clipboard/clipboard` dependency), so the control renders in
//     an explicit unavailable/disabled state until a host registers one, and
//     never claims success without a real write (documented in the sidecar).
//
// react-i18next is replaced by a self-contained fallback that preserves each key
// (`t('Url Encoder')`, `t('Url Encoder Desc')`, `t('Encode')`, `t('Decode')`,
// `t('Input Label')`, `t('Output Label')`, `t('Invalid Input')`). No DOM, no
// lucide-react, no Recharts/Leaflet, and no web UI components are imported.

import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Icon,
  type IconComponentType,
  type IconRenderProps,
} from '../../../../../components/ui/Icon';
import { getSemanticIconDefinition } from '../../../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../../../theme/tokens';

type NativeTFunction = (key: string, fallback?: string) => string;

// Native parity has no i18n runtime wired, so this returns the supplied fallback
// or the key itself — preserving the web `t('Url Encoder')` / `t('Invalid
// Input')` intent where the English string is the key (these dev-tools keys are
// absent from en.json, so web i18next also renders the key literally).
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

// Native analogue of the web devtools ICON_COLOR_MAP (`bg-neon-{c}/10
// text-neon-{c} ring-1 ring-neon-{c}/20`). Each key maps to the matching token
// stop for the glyph, the soft surface fill, and the hairline ring border. The
// web UrlEncoder uses `color="cyan"`; the full map is kept so the ToolCard's
// generic `?? cyan` default is reproduced faithfully.
const ICON_TINTS: Record<
  string,
  { glyph: string; surface: string; border: string }
> = {
  cyan: {
    glyph: colors.accent,
    surface: colors.accentSoft,
    border: colors.borderAccent,
  },
  green: {
    glyph: colors.success,
    surface: colors.successSurface,
    border: colors.successBorder,
  },
  purple: {
    glyph: colors.violet,
    surface: colors.violetSurface,
    border: colors.violetBorder,
  },
  amber: {
    glyph: colors.warning,
    surface: colors.warningSurface,
    border: colors.warningBorder,
  },
  red: {
    glyph: colors.danger,
    surface: colors.dangerSurface,
    border: colors.dangerBorder,
  },
};

// web `text-cyan-300` for the derived readout; recreated here the same way the
// sibling HashCalculator port recreates web-exact colours the token set does not
// expose at this precise stop (HashCalculator uses text-rose-300 = #fda4af).
const CYAN_300 = '#67e8f9';

// Repo-canonical native stand-in for the lucide `Link` glyph: the `link`
// SemanticIcon (`LN`, accent tone). Resolved once at module scope.
const LINK_GLYPH = getSemanticIconDefinition('link').glyph;

// Clipboard provider registry — mirrors the sibling HashCalculator / BackendTool
// ports. The native build ships no clipboard module, so copy stays a no-op (and
// the control renders disabled) until a host registers a real writer. Exposing
// the setter keeps the affordance honest: it only flips to "Copied" after a
// write resolves.
type ClipboardWriter = (text: string) => Promise<void> | void;
let clipboardWriter: ClipboardWriter | null = null;

export function registerDevtoolsClipboardWriter(
  writer: ClipboardWriter | null,
): () => void {
  clipboardWriter = writer;
  return () => {
    if (clipboardWriter === writer) {
      clipboardWriter = null;
    }
  };
}

// IconComponentType-shaped stand-in for the lucide `Link` glyph: renders the
// canonical `link` SemanticIcon glyph (`LN`) at the requested numeric size/
// colour, forwarding the accessibility props the shared `Icon` wrapper supplies.
// The 2-char glyph is sized to ~0.6x the box (the same treatment the sibling
// ReferenceLinksSection port uses for its 2-char glyphs). No DOM/lucide `<svg>`.
function LinkGlyph({
  size = 16,
  color = colors.textPrimary,
  style,
  accessible,
  accessibilityRole,
  accessibilityLabel,
  accessibilityElementsHidden,
  importantForAccessibility,
}: IconRenderProps) {
  const fontSize = Math.round(size * 0.6);
  return (
    <Text
      accessibilityElementsHidden={accessibilityElementsHidden}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessible={accessible}
      allowFontScaling={false}
      importantForAccessibility={importantForAccessibility}
      style={[
        {
          color,
          fontSize,
          fontWeight: '700',
          letterSpacing: 0.4,
          lineHeight: size,
          minWidth: size,
          textAlign: 'center',
        },
        style,
      ]}>
      {LINK_GLYPH}
    </Text>
  );
}

// Native parity for the web primary/ghost/sm Button used as a mode toggle.
// Active = filled accent (web `variant="primary"`); inactive = transparent with
// a hairline border (web `variant="ghost"`), keeping the tap target legible.
function ModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        active ? styles.modeButtonActive : styles.modeButtonGhost,
        pressed && styles.pressed,
      ]}>
      <AppText
        style={active ? styles.modeButtonActiveText : styles.modeButtonGhostText}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// Native parity for the shared web CopyButton, gated behind the clipboard
// registry. Disabled (with an explicit a11y state) when no writer is wired.
function CopyButton({ text }: { text: string }) {
  const t = useNativeTranslationFallback();
  const [copied, setCopied] = useState(false);
  const available = clipboardWriter != null;

  const onPress = useCallback(() => {
    const writer = clipboardWriter;
    if (writer == null) {
      return;
    }
    void (async () => {
      try {
        await writer(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Swallow copy failures — the output text remains visible regardless.
      }
    })();
  }, [text]);

  const label = copied
    ? t('common.copyButton.copied', 'Copied')
    : t('common.copyButton.copy', 'Copy');

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={onPress}
      style={({ pressed }) => [
        styles.copyButton,
        pressed && available && styles.pressed,
      ]}>
      <AppText
        tone={available ? 'secondary' : 'muted'}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

interface ToolCardViewProps {
  icon: IconComponentType;
  color: string;
  title: string;
  description: string;
  children: ReactNode;
}

// Native parity for web/src/features/admin/components/devtools/ToolCard.tsx.
function ToolCardView({
  icon,
  color,
  title,
  description,
  children,
}: ToolCardViewProps) {
  const tint = ICON_TINTS[color] ?? ICON_TINTS.cyan;

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.header}>
        <View
          style={[
            styles.iconBox,
            { backgroundColor: tint.surface, borderColor: tint.border },
          ]}>
          <Icon color={tint.glyph} icon={icon} size="lg" />
        </View>
        <View style={styles.headerText}>
          <AppText style={styles.cardTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.cardDesc} tone="secondary" variant="caption">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

export function UrlEncoderTool() {
  const t = useNativeTranslationFallback();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [inputVal, setInputVal] = useState('');
  const output = useMemo(() => {
    if (!inputVal) {
      return '';
    }
    try {
      return mode === 'encode'
        ? encodeURIComponent(inputVal)
        : decodeURIComponent(inputVal);
    } catch {
      return t('Invalid Input');
    }
  }, [inputVal, mode, t]);

  return (
    <ToolCardView
      color="cyan"
      description={t('Url Encoder Desc')}
      icon={LinkGlyph}
      title={t('Url Encoder')}>
      <View style={styles.body}>
        <View style={styles.modeRow}>
          <ModeButton
            active={mode === 'encode'}
            label={t('Encode')}
            onPress={() => setMode('encode')}
          />
          <ModeButton
            active={mode === 'decode'}
            label={t('Decode')}
            onPress={() => setMode('decode')}
          />
        </View>
        <View>
          <AppText
            style={styles.fieldLabel}
            tone="secondary"
            variant="caption"
            weight="semibold">
            {t('Input Label')}
          </AppText>
          <TextInput
            multiline
            numberOfLines={2}
            onChangeText={setInputVal}
            placeholder={
              mode === 'encode'
                ? 'hello world&foo=bar'
                : 'hello%20world%26foo%3Dbar'
            }
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            style={styles.input}
            textAlignVertical="top"
            value={inputVal}
          />
        </View>
        {output ? (
          <View style={styles.outputPanel}>
            <View style={styles.outputHeader}>
              <AppText tone="secondary" variant="caption">
                {t('Output Label')}
              </AppText>
              <CopyButton text={output} />
            </View>
            <Text style={styles.outputCode}>{output}</Text>
          </View>
        ) : null}
      </View>
    </ToolCardView>
  );
}

UrlEncoderTool.displayName = 'UrlEncoderTool';

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  card: {
    padding: spacing.lg,
  },
  cardDesc: {
    lineHeight: 16,
    marginTop: 2,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  copyButton: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  fieldLabel: {
    marginBottom: 4,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: 16,
  },
  headerText: {
    flex: 1,
    flexShrink: 1,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexShrink: 0,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  modeButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  modeButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modeButtonActiveText: {
    color: colors.background,
    fontSize: 12,
  },
  modeButtonGhost: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  modeButtonGhostText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  outputCode: {
    color: CYAN_300,
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  outputHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  outputPanel: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.82,
  },
});
