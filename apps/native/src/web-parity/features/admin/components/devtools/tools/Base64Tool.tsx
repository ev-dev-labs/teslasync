// Native parity port of
// web/src/features/admin/components/devtools/tools/Base64Tool.tsx.
//
// `Base64Tool` is a devtools card with an encode/decode mode toggle, a 3-row
// text input, and (when there's output) a result box with a copy affordance.
// State (`mode`/`setMode`, `inputVal`/`setInputVal`), the memoized `output`
// derivation, the encode/decode branch, the invalid-input fallback, the
// placeholder strings, and every i18n key are preserved verbatim from the web
// source. The web source pulls modules with no native-parity surface, mapped
// per the conversion contract (rules 4/5/6/7):
//   - react/useState/useMemo (L1) kept as-is; `useCallback` is added only for
//     the local i18n shim + the copy handler.
//   - react-i18next `useTranslation` (L2) -> the standard web-parity i18n shim.
//     The web body calls `t('Encode')`, `t('Decode')`, `t('Input Label')`,
//     `t('Output Label')` and `t('Invalid Input')` with NO inline fallback, so
//     (unlike the fallback-only shim used by the sibling ports) this shim
//     returns `fallback ?? key`, exactly matching react-i18next's "return the
//     key when there is no translation/fallback" behaviour. `t(key, fallback)`
//     calls (the two ToolCard strings) still resolve to their English fallback.
//   - lucide-react `Braces` (L3, SVG) has no native analog -> a decorative
//     AppText '{ }' glyph inside the ToolCard icon box (the FleetTelemetryHealth
//     glyph approach).
//   - `Button` + `Textarea` + `CopyButton` from @/components/ui (L4/L6): the
//     web-parity `Textarea` (web-parity/components/ui/Textarea) is reused as-is.
//     There is no parity `Button` or `CopyButton`, so both are rebuilt locally
//     with `Pressable` + `AppText` (the PrintButton/FullscreenButton precedent),
//     reproducing the web Button `primary`/`ghost` + `sm` styling and the
//     CopyButton ghost/sm + Copy/Copied toggle + its i18n keys.
//   - `ToolCard` (L5, sibling ../ToolCard) is not ported yet, so its card chrome
//     (GlassPanel p-5 + tinted 40x40 icon box + title/description) is reproduced
//     by a local `ToolCard` helper -- the same "own the unported sibling
//     locally" approach used by the FleetTelemetryHealth port. The web ToolCard
//     `icon`/`color` props collapse to a `glyph` + `color` (the ICON_COLOR_MAP
//     palette, with the same cyan default as the web `?? ICON_COLOR_MAP.cyan`).
//
// Browser-only behaviour (rule 7):
//   - `btoa`/`atob` (web L15) are DOM globals absent from Hermes. They are
//     invoked verbatim where present (react-native-web / Node-backed jest, which
//     both expose them) and otherwise fall back to spec-faithful pure-JS
//     polyfills that THROW on invalid input exactly like the browser globals, so
//     the `catch -> t('Invalid Input')` path is preserved on every platform.
//   - `CopyButton` used `navigator.clipboard.writeText` (web CopyButton L73).
//     The clipboard is written verbatim where `navigator.clipboard` exists
//     (react-native-web); on true native there is no `navigator.clipboard` and
//     the app bundles no clipboard module, so the write is the explicit
//     unavailable state required by rule 7 (logged, no false "Copied" toggle).
//
// Visual intent: web `color="amber"` -> warning surface/border/foreground
// tokens. Tailwind body classes map to the toned-down SI palette: text-cyan-300
// -> #67e8f9; --text-secondary -> colors.textSecondary. bg-[var(--surface-overlay)]
// -> the canonical dark overlay rgba(0,0,0,0.6). font-mono -> Platform.select
// monospace. Tailwind spacing -> px (space-y-3 -> gap 12, gap-2 -> 8, text-xs ->
// 12/16, text-sm -> 14/20, font-medium -> '500', font-semibold -> '600', mb-1 /
// mt-1 -> 4, rounded -> 4, rounded-md -> 6, rounded-lg -> 8, p-3 -> 12, p-5 ->
// 20, h-8 -> 32, h-10/w-10 -> 40). The web Button `hover:` tints have no touch
// analog and collapse into Pressable pressed styles; `whitespace-pre-wrap
// break-all` (the <pre>) maps to React Native Text's default wrap (newlines /
// whitespace preserved, long unbroken strings wrapped to fit) and the output is
// made `selectable` so it can still be copied by hand on true native.

import React, {useCallback, useMemo, useState} from 'react';
import {Platform, Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../../theme/tokens';
import {Textarea} from '../../../../../components/ui/Textarea';

// ── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next has no native parity module. The web body mixes
// `t(key, fallback)` (the two ToolCard strings) and bare `t(key)` calls (Encode
// / Decode / Input Label / Output Label / Invalid Input). To match react-i18next
// — which returns the inline fallback when given one and otherwise echoes the
// key — this shim resolves to `fallback ?? key`. The hook shape mirrors the web
// `const { t } = useTranslation()` so the component body is unchanged.
type TFn = (key: string, fallback?: string) => string;

function useTranslation(): {t: TFn} {
  const t = useCallback<TFn>((key, fallback) => fallback ?? key, []);
  return {t};
}

// Toned-down SI body-text palette + dark surface overlay (web text-*/bg-* CSS
// classes have no className analog on native).
const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});
const CYAN_300 = '#67e8f9'; // text-cyan-300
const SURFACE_OVERLAY = 'rgba(0, 0, 0, 0.6)'; // --surface-overlay (dark canonical)

// ── Base64 codec (web btoa/atob) ─────────────────────────────────────────────
// btoa/atob are browser globals; Hermes lacks them. Prefer the real global when
// present (react-native-web + Node-backed jest expose them, preserving the exact
// web behaviour) and otherwise use a spec-faithful pure-JS polyfill that throws
// on invalid input exactly like the browser globals, so the web
// `catch -> t('Invalid Input')` path holds on every platform.
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function btoaPolyfill(input: string): string {
  let output = '';
  for (let i = 0; i < input.length; i += 3) {
    const has1 = i + 1 < input.length;
    const has2 = i + 2 < input.length;
    const c0 = input.charCodeAt(i);
    const c1 = has1 ? input.charCodeAt(i + 1) : 0;
    const c2 = has2 ? input.charCodeAt(i + 2) : 0;
    if (c0 > 0xff || c1 > 0xff || c2 > 0xff) {
      // Mirrors the browser btoa InvalidCharacterError for code points > 0xFF.
      throw new Error(
        'btoa: the string to be encoded contains characters outside the Latin1 range.',
      );
    }
    const triplet = (c0 << 16) | (c1 << 8) | c2;
    output +=
      BASE64_ALPHABET.charAt((triplet >> 18) & 0x3f) +
      BASE64_ALPHABET.charAt((triplet >> 12) & 0x3f) +
      (has1 ? BASE64_ALPHABET.charAt((triplet >> 6) & 0x3f) : '=') +
      (has2 ? BASE64_ALPHABET.charAt(triplet & 0x3f) : '=');
  }
  return output;
}

function atobPolyfill(input: string): string {
  const stripped = input.replace(/[\t\n\f\r ]+/g, '').replace(/={1,2}$/, '');
  if (/[^A-Za-z0-9+/]/.test(stripped) || stripped.length % 4 === 1) {
    // Mirrors the browser atob InvalidCharacterError for malformed base64.
    throw new Error('atob: the string to be decoded is not correctly encoded.');
  }
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < stripped.length; i += 1) {
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(stripped.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

function toBase64(value: string): string {
  const encode = (
    globalThis as typeof globalThis & {btoa?: (data: string) => string}
  ).btoa;
  return typeof encode === 'function' ? encode(value) : btoaPolyfill(value);
}

function fromBase64(value: string): string {
  const decode = (
    globalThis as typeof globalThis & {atob?: (data: string) => string}
  ).atob;
  return typeof decode === 'function' ? decode(value) : atobPolyfill(value);
}

// Web CopyButton wrote via navigator.clipboard.writeText. Honour the real
// clipboard where present (react-native-web); return false on true native where
// no clipboard module is bundled (the rule-7 explicit unavailable state).
async function writeClipboard(value: string): Promise<boolean> {
  const clipboard = (
    globalThis as typeof globalThis & {
      navigator?: {clipboard?: {writeText?: (data: string) => Promise<void>}};
    }
  ).navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    await clipboard.writeText(value);
    return true;
  }
  return false;
}

// ── Button (web @/components/ui Button, variant primary/ghost size sm) ────────
type ToolButtonVariant = 'primary' | 'ghost';

interface ButtonTint {
  bg: string;
  pressedBg: string;
  text: string;
}

// Dark-mode Tailwind hex for the web Button variants used here. primary:
// bg-blue-600 text-white hover:bg-blue-700. ghost: bg-transparent
// hover:bg-gray-100 dark:hover:bg-gray-800 (inherits the secondary text colour).
const BUTTON_VARIANTS: Record<ToolButtonVariant, ButtonTint> = {
  primary: {bg: '#2563eb', pressedBg: '#1d4ed8', text: '#ffffff'},
  ghost: {
    bg: 'transparent',
    pressedBg: colors.surfaceHover,
    text: colors.textSecondary,
  },
};

interface ToolButtonProps {
  label: string;
  variant: ToolButtonVariant;
  onPress: () => void;
}

function ToolButton({label, variant, onPress}: ToolButtonProps) {
  const tint = BUTTON_VARIANTS[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected: variant === 'primary'}}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        {backgroundColor: pressed ? tint.pressedBg : tint.bg},
      ]}>
      <AppText style={[styles.buttonLabel, {color: tint.text}]}>{label}</AppText>
    </Pressable>
  );
}

// ── CopyButton (web @/components/ui CopyButton, ghost/sm defaults) ────────────
function CopyButton({text}: {text: string}) {
  const {t} = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyLabel = t('common.copyButton.copy', 'Copy');
  const copiedLabel = t('common.copyButton.copied', 'Copied');

  const handleCopy = useCallback(async () => {
    try {
      const ok = await writeClipboard(text);
      if (!ok) {
        // Clipboard unavailable on this platform (true native has no
        // navigator.clipboard and no clipboard module is bundled). Do not flip
        // to "Copied", matching the web "only on success" behaviour.
        console.error('CopyButton: clipboard unavailable on this platform');
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('CopyButton: clipboard write failed', err);
    }
  }, [text]);

  const tint = BUTTON_VARIANTS.ghost;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? copiedLabel : copyLabel}
      accessibilityLiveRegion="polite"
      hitSlop={6}
      onPress={handleCopy}
      style={({pressed}) => [
        styles.button,
        {backgroundColor: pressed ? tint.pressedBg : tint.bg},
      ]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.copyIcon, {color: tint.text}]}>
        {copied ? '\u2713' : '\u29c9'}
      </AppText>
      <AppText style={[styles.buttonLabel, {color: tint.text}]}>
        {copied ? copiedLabel : copyLabel}
      </AppText>
    </Pressable>
  );
}

// ── ToolCard (local chrome; sibling ../ToolCard not ported yet) ──────────────
interface ToolTone {
  bg: string;
  border: string;
  fg: string;
}

// web ICON_COLOR_MAP: bg-neon-{color}/10 + ring neon-{color}/20 + text
// neon-{color} -> the native accent/success/violet/warning/danger tokens.
const TOOL_TONES: Record<string, ToolTone> = {
  cyan: {bg: colors.accentSoft, border: colors.borderAccent, fg: colors.accent},
  green: {
    bg: colors.successSurface,
    border: colors.successBorder,
    fg: colors.success,
  },
  purple: {
    bg: colors.violetSurface,
    border: colors.violetBorder,
    fg: colors.violet,
  },
  amber: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
  },
  red: {bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger},
};

interface ToolCardProps {
  /** Decorative glyph standing in for the lucide icon. */
  glyph: string;
  /** Maps the web ToolCard `color` prop (amber here). */
  color: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

function ToolCard({glyph, color, title, description, children}: ToolCardProps) {
  // Web: ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan.
  const palette = TOOL_TONES[color] ?? TOOL_TONES.cyan;
  return (
    <GlassPanel style={styles.toolCard}>
      <View style={styles.toolCardHeader}>
        <View
          style={[
            styles.toolCardIcon,
            {backgroundColor: palette.bg, borderColor: palette.border},
          ]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.toolCardGlyph, {color: palette.fg}]}>
            {glyph}
          </AppText>
        </View>
        <View style={styles.toolCardTitleWrap}>
          <AppText style={styles.toolCardTitle}>{title}</AppText>
          <AppText style={styles.toolCardDesc}>{description}</AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

export function Base64Tool() {
  const {t} = useTranslation();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [inputVal, setInputVal] = useState('');
  const output = useMemo(() => {
    if (!inputVal) {
      return '';
    }
    try {
      return mode === 'encode' ? toBase64(inputVal) : fromBase64(inputVal);
    } catch {
      return t('Invalid Input');
    }
  }, [inputVal, mode, t]);

  return (
    <ToolCard
      glyph="{ }"
      color="amber"
      title={t('devtools.utils.base64', 'Base64')}
      description={t('devtools.utils.base64Desc', 'Base64Desc')}>
      <View style={styles.stack}>
        <View style={styles.modeRow}>
          <ToolButton
            label={t('Encode')}
            variant={mode === 'encode' ? 'primary' : 'ghost'}
            onPress={() => setMode('encode')}
          />
          <ToolButton
            label={t('Decode')}
            variant={mode === 'decode' ? 'primary' : 'ghost'}
            onPress={() => setMode('decode')}
          />
        </View>
        <View>
          <AppText style={styles.inputLabel}>{t('Input Label')}</AppText>
          <Textarea
            rows={3}
            value={inputVal}
            onChangeText={setInputVal}
            placeholder={mode === 'encode' ? 'Hello World' : 'SGVsbG8gV29ybGQ='}
          />
        </View>
        {output ? (
          <View style={styles.outputBox}>
            <View style={styles.outputHeader}>
              <AppText style={styles.outputLabel}>{t('Output Label')}</AppText>
              <CopyButton text={output} />
            </View>
            <AppText selectable style={styles.outputText}>
              {output}
            </AppText>
          </View>
        ) : null}
      </View>
    </ToolCard>
  );
}

export default Base64Tool;

const styles = StyleSheet.create({
  stack: {
    gap: 12, // space-y-3
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  button: {
    alignItems: 'center',
    borderRadius: 6, // rounded-md
    flexDirection: 'row',
    gap: 8, // gap-2
    justifyContent: 'center',
    minHeight: 32, // h-8
    paddingHorizontal: 12, // px-3
  },
  buttonLabel: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  copyIcon: {
    fontSize: 13, // h-3.5 w-3.5
    lineHeight: 16,
  },
  inputLabel: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
    marginBottom: 4, // mb-1
  },
  outputBox: {
    backgroundColor: SURFACE_OVERLAY, // bg-[var(--surface-overlay)]
    borderRadius: 4, // rounded
    padding: 12, // p-3
  },
  outputHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  outputLabel: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  outputText: {
    color: CYAN_300, // text-cyan-300
    fontFamily: MONO_FONT, // font-mono
    fontSize: 14, // text-sm
    lineHeight: 20,
    marginTop: 4, // mt-1
  },
  toolCard: {
    padding: 20, // p-5
  },
  toolCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12, // gap-3
    marginBottom: 16, // mb-4
  },
  toolCardIcon: {
    alignItems: 'center',
    borderRadius: 8, // rounded-lg
    borderWidth: 1, // ring-1
    height: 40, // h-10
    justifyContent: 'center',
    width: 40, // w-10
  },
  toolCardGlyph: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  toolCardTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  toolCardTitle: {
    color: colors.textPrimary, // text-white
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 20,
  },
  toolCardDesc: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
});
