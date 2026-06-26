// Native parity port of
// web/src/features/admin/components/devtools/tools/HashCalculator.tsx.
//
// The web source is a self-contained dev-tools card: paste text, press
// "Compute Sha256", and a rose-coloured monospace SHA-256 hex digest appears
// next to a copy affordance. It composes three web pieces — `ToolCard` (a
// GlassPanel with a coloured icon header), the shared `Button`/`Textarea`
// inputs, the shared `CopyButton`, and the lucide `Hash` glyph — and computes
// the digest with the browser-only Web Crypto API
// (`new TextEncoder().encode(...)` + `crypto.subtle.digest('SHA-256', ...)`).
//
// None of those exist in React Native, so — mirroring how the sibling
// `BackendTool` native port inlines the pieces it needs — this self-contained
// port rebuilds each dependency with React Native primitives and existing
// native tokens:
//   * `crypto.subtle.digest('SHA-256', ...)` + `TextEncoder` are BROWSER-ONLY
//     and absent from the native runtime (no Web Crypto, no crypto polyfill in
//     apps/native dependencies). They are replaced with a faithful, dependency-
//     free pure-JS SHA-256 (`sha256Hex`) that does its own UTF-8 encoding, so
//     the produced 64-char lowercase hex digest is byte-for-byte identical to
//     the web output (verified against Node's `crypto` for ASCII, the standard
//     test vectors, and multi-byte/surrogate-pair Unicode). Behaviour, not just
//     an "unavailable" stub, is preserved.
//   * `ToolCard` becomes a native `GlassPanel` with a tinted icon box rendered
//     through the shared native `Icon` wrapper (the web ICON_COLOR_MAP neon
//     classes map to the matching token colour stops, defaulting to cyan).
//   * The lucide `Hash` glyph becomes `HashGlyph`, an `IconComponentType`-shaped
//     component rendering the `#` character sized/coloured like the source's
//     `h-5 w-5` / `h-3.5 w-3.5` usages — no DOM/lucide import.
//   * The web `Textarea` (sm, 2 rows) becomes a native multiline `TextInput`.
//   * The web primary/sm `Button` (loading + Hash icon) becomes a native
//     Pressable swapping the glyph for an ActivityIndicator while computing.
//   * The shared `CopyButton` maps to a clipboard control gated behind a
//     registerable writer — native parity ships no clipboard module (no
//     `@react-native-clipboard/clipboard` dependency), so the control renders
//     in an explicit unavailable/disabled state until a host registers one, and
//     never claims success without a real write (documented in the sidecar).
//
// react-i18next is replaced by a self-contained fallback that preserves each
// key (`t('Hash Calculator')`, `t('Hash Input')`, `t('Hash Placeholder')`,
// `t('devtools.utils.computeSha256', 'Compute Sha256')`, `t('Hash Error')`).
// No DOM, no lucide-react, no Recharts/Leaflet, and no web UI components are
// imported.

import React, { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  Icon,
  type IconComponentType,
  type IconRenderProps,
} from '../../../../../components/ui/Icon';
import { AppText } from '../../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../../../theme/tokens';

type NativeTFunction = (key: string, fallback?: string) => string;

// Native parity has no i18n runtime wired, so this returns the supplied fallback
// or the key itself — preserving the web `t('Hash Calculator')` /
// `t('devtools.utils.computeSha256', 'Compute Sha256')` intent where the English
// string is the key.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

// Native analogue of the web devtools ICON_COLOR_MAP (`bg-neon-{c}/10
// text-neon-{c} ring-1 ring-neon-{c}/20`). Each key maps to the matching token
// stop for the glyph, the soft surface fill, and the hairline ring border. The
// web HashCalculator uses `color="red"`; the full map is kept so the ToolCard's
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

// web `text-rose-300` for the digest readout; recreated here the same way the
// sibling BackendTool port recreates web-exact colours the token set does not
// expose at this precise stop.
const ROSE_300 = '#fda4af';

// ─── SHA-256 (pure JS, native-safe replacement for Web Crypto) ──────────────
//
// Faithful stand-in for the web path
// `crypto.subtle.digest('SHA-256', new TextEncoder().encode(inputVal))` →
// per-byte hex. Implemented without any browser API so it runs unchanged in the
// React Native runtime; output is byte-for-byte identical to the web digest.

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotr(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

// UTF-8 encode a string into a byte array — the native-safe equivalent of the
// web `new TextEncoder().encode(inputVal)`, including surrogate-pair handling.
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const high = code;
      const low = input.charCodeAt(++i);
      code = 0x10000 + ((high & 0x3ff) << 10) + (low & 0x3ff);
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

function sha256Hex(message: string): string {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];

  const bytes = utf8Bytes(message);
  const bitLength = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push(
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff,
  );

  const w = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        ((bytes[j] << 24) |
          (bytes[j + 1] << 16) |
          (bytes[j + 2] << 8) |
          bytes[j + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i++) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + bigS1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigS0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return h.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

// Clipboard provider registry — mirrors the sibling BackendTool port. The native
// build ships no clipboard module, so copy stays a no-op (and the control
// renders disabled) until a host registers a real writer. Exposing the setter
// keeps the affordance honest: it only flips to "Copied" after a write resolves.
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

// IconComponentType-shaped stand-in for the lucide `Hash` glyph: renders the `#`
// character at the requested numeric size/colour, forwarding the accessibility
// props the shared `Icon` wrapper supplies. No DOM/lucide `<svg>` is imported.
function HashGlyph({
  size = 16,
  color = colors.textPrimary,
  style,
  accessible,
  accessibilityRole,
  accessibilityLabel,
  accessibilityElementsHidden,
  importantForAccessibility,
}: IconRenderProps) {
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
          fontSize: size,
          fontWeight: '700',
          lineHeight: size,
          textAlign: 'center',
          width: size,
        },
        style,
      ]}>
      #
    </Text>
  );
}

// Native parity for the web primary/sm Button: loading swaps the Hash glyph for
// a spinner and disables the press, matching `disabled={disabled || loading}`.
function ComputeButton({
  label,
  loading,
  onPress,
}: {
  label: string;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.computeButton,
        loading && styles.computeButtonDisabled,
        pressed && !loading && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        <HashGlyph
          accessibilityElementsHidden
          color={colors.background}
          importantForAccessibility="no-hide-descendants"
          size={14}
        />
      )}
      <AppText style={styles.computeButtonText} weight="semibold">
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
        // Swallow copy failures — the digest text remains visible regardless.
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

export function HashCalculatorTool() {
  const t = useNativeTranslationFallback();
  const [inputVal, setInputVal] = useState('');
  const [hashResult, setHashResult] = useState('');
  const [computing, setComputing] = useState(false);

  const compute = useCallback(async () => {
    if (!inputVal) {
      return;
    }
    setComputing(true);
    try {
      // Yield once so the loading state can paint, mirroring the asynchronous
      // web `await crypto.subtle.digest(...)`; the digest itself is synchronous.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      const hex = sha256Hex(inputVal);
      setHashResult(hex);
    } catch {
      setHashResult(t('Hash Error'));
    }
    setComputing(false);
  }, [inputVal, t]);

  return (
    <ToolCardView
      color="red"
      description={t('Hash Calculator Desc')}
      icon={HashGlyph}
      title={t('Hash Calculator')}>
      <View style={styles.body}>
        <View>
          <AppText
            style={styles.fieldLabel}
            tone="secondary"
            variant="caption"
            weight="semibold">
            {t('Hash Input')}
          </AppText>
          <TextInput
            multiline
            numberOfLines={2}
            onChangeText={setInputVal}
            placeholder={t('Hash Placeholder')}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            style={styles.input}
            textAlignVertical="top"
            value={inputVal}
          />
        </View>
        <ComputeButton
          label={t('devtools.utils.computeSha256', 'Compute Sha256')}
          loading={computing}
          onPress={() => void compute()}
        />
        {hashResult ? (
          <View style={styles.resultRow}>
            <Text style={styles.resultCode}>{hashResult}</Text>
            <CopyButton text={hashResult} />
          </View>
        ) : null}
      </View>
    </ToolCardView>
  );
}

HashCalculatorTool.displayName = 'HashCalculatorTool';

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
  computeButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  computeButtonDisabled: {
    opacity: 0.5,
  },
  computeButtonText: {
    color: colors.background,
    fontSize: 12,
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
  pressed: {
    opacity: 0.82,
  },
  resultCode: {
    color: ROSE_300,
    flex: 1,
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  resultRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
