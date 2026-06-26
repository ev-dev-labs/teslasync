/**
 * Native parity port of
 * web/src/features/admin/components/devtools/tools/UuidGenerator.tsx.
 *
 * The web file is the DevTools "UUID Generator" tool: a ToolCard wrapping a
 * "Generate" button that pushes a fresh v4 UUID onto a newest-first list capped
 * at 10 entries, each row showing the monospaced UUID + a one-click CopyButton.
 * This native port preserves that contract 1:1 — the same `uuids` state, the
 * same `generate` useCallback ([uuid, ...prev].slice(0, 10) newest-first cap),
 * the same render tree (Generate button + conditional 10-row list + per-row
 * copy affordance) — using React Native primitives + the existing native
 * AppText / GlassPanel / design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2/L10): replaced by a native-safe
 *     `t(key, fallback?)` fallback (the established sibling ClientUtilitiesSection
 *     / HttpStatusTool precedent) that returns the English default, else the key.
 *     Every web key is preserved verbatim ('Uuid Generator' / 'Uuid Generator
 *     Desc' / 'Generate', plus CopyButton's common.copyButton.copy/.copied).
 *   - lucide-react `Fingerprint` / `RefreshCw` (web L3): rendered as decorative
 *     `AppText` glyphs — Fingerprint -> '\u2042' (the exact glyph the sibling
 *     ClientUtilitiesSection port uses for the Fingerprint icon) for the ToolCard
 *     header chip, RefreshCw -> '\u21BB' (clockwise arrow) for the Generate
 *     button's leading icon.
 *   - `@/components/ui` `Button` (web L4): no native parity port yet, so a minimal
 *     native-safe `GenerateButton` (a primary, sm-sized Pressable with a leading
 *     glyph + label, the established "reproduce locally" precedent) reproduces the
 *     `variant='primary' size='sm' icon={<RefreshCw/>}` intent.
 *   - `../ToolCard` + `./constants` ICON_COLOR_MAP (web ToolCard L4): reproduced
 *     locally as `ToolCard` (GlassPanel header chip + title/description + children)
 *     since no native ToolCard parity port exists. The web Tailwind
 *     `bg-neon-{c}/10 text-neon-{c} ring-1 ring-neon-{c}/20` chip classes map to
 *     native chip styles on the equivalent design tokens (cyan->accent,
 *     green->success, purple->violet, amber->warning, red->danger), matching the
 *     sibling ClientUtilitiesSection / HttpStatusTool mapping.
 *   - `@/components/ui` `CopyButton` (web L6): no native parity port yet, so a
 *     minimal native-safe `UuidCopyButton` reproduces its Copy -> Copied(2s)
 *     toggle + best-effort `navigator.clipboard` write (works on the
 *     web/react-native-web target; a documented no-op on a bare native device with
 *     no clipboard module), keeping the original i18n keys
 *     (common.copyButton.copy/.copied) and the lucide Copy/CheckCircle icons as
 *     decorative glyphs (\u29C9 idle / \u2713 copied) — the established sibling
 *     ResultPanel copy-affordance precedent.
 *   - `@/lib/safeUUID` `safeRandomUUID` (web L7): ported verbatim as a local
 *     native-safe `safeRandomUUID` (the established "reproduce locally when no
 *     native parity port exists" precedent). The browser-global `crypto` is read
 *     via `globalThis` so the RFC 4122 §4.4 v4 construction is type-safe and falls
 *     through randomUUID -> getRandomValues -> Math.random exactly as the web
 *     source, covering non-secure-context and crypto-missing (bare native) targets.
 *   - The web responsive Tailwind layout (`space-y-3` / `space-y-1` / row flex,
 *     `text-purple-300` code) maps to native StyleSheet spacing/typography tokens
 *     (purple-300 -> the literal #d8b4fe, mirroring the sibling ResultPanel
 *     rose-300 literal precedent).
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../../../theme/tokens';

/* ── native translation fallback (native-safe port of react-i18next) ── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: returns the English default, else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key: string, fallback?: string) => fallback ?? key,
    [],
  );
}

/* ── decorative glyph stand-ins for the lucide-react icons ── */

const FINGERPRINT_GLYPH = '\u2042';
const REFRESH_GLYPH = '\u21BB';
const COPY_GLYPH = '\u29C9';
const COPIED_GLYPH = '\u2713';

/** Tailwind purple-300 — preserves the web `text-purple-300` code shade. */
const PURPLE_300 = '#d8b4fe';

/** How long the copy affordance shows "Copied" before resetting (web 2000ms). */
const COPIED_RESET_MS = 2000;

/* ── native-safe v4 UUID (verbatim logic port of `@/lib/safeUUID`) ── */

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
};

/** Reads the (optional) global `crypto` without depending on a DOM lib type. */
function getCrypto(): CryptoLike | undefined {
  return (globalThis as {crypto?: CryptoLike}).crypto;
}

/**
 * Generates a v4 UUID even when `crypto.randomUUID` is unavailable.
 *
 * `crypto.randomUUID` is restricted to secure contexts on the web, and on a bare
 * native runtime `crypto` may be absent entirely. `crypto.getRandomValues` is
 * used when present (RFC 4122 §4.4 construction); the `Math.random` branch is the
 * last resort (uniqueness-only IDs, not cryptographically secure).
 */
export function safeRandomUUID(): string {
  const cryptoObj = getCrypto();
  try {
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return cryptoObj.randomUUID();
    }
  } catch {
    /* locked context — drop through to the constructed-UUID branch */
  }

  const bytes = new Uint8Array(16);
  try {
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      cryptoObj.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
  } catch {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  /* RFC 4122 §4.4: set the version field to 0100xxxx (v4) in byte 6
   * and the variant field to 10xxxxxx in byte 8. */
  // eslint-disable-next-line no-bitwise
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // eslint-disable-next-line no-bitwise
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
    `${hex[4]}${hex[5]}-` +
    `${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-` +
    `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  );
}

/* ── icon chip colour map (native-safe port of `./constants` ICON_COLOR_MAP) ── */

interface ChipStyle {
  backgroundColor: string;
  color: string;
  borderColor: string;
}

const CHIP_COLORS: Record<string, ChipStyle> = {
  cyan: {
    backgroundColor: colors.accentSoft,
    color: colors.accent,
    borderColor: colors.borderAccent,
  },
  green: {
    backgroundColor: colors.successSurface,
    color: colors.success,
    borderColor: colors.successBorder,
  },
  purple: {
    backgroundColor: colors.violetSurface,
    color: colors.violet,
    borderColor: colors.violetBorder,
  },
  amber: {
    backgroundColor: colors.warningSurface,
    color: colors.warning,
    borderColor: colors.warningBorder,
  },
  red: {
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
    borderColor: colors.dangerBorder,
  },
};

/* ── native ToolCard stand-in (`../ToolCard`) ── */

function ToolCard({
  glyph,
  color,
  title,
  description,
  children,
}: {
  glyph: string;
  color: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const chip = CHIP_COLORS[color] ?? CHIP_COLORS.cyan;
  return (
    <GlassPanel style={styles.toolCard}>
      <View style={styles.toolHeader}>
        <View
          style={[
            styles.toolIcon,
            {backgroundColor: chip.backgroundColor, borderColor: chip.borderColor},
          ]}>
          <AppText style={[styles.toolGlyph, {color: chip.color}]}>{glyph}</AppText>
        </View>
        <View style={styles.toolHeaderText}>
          <AppText style={styles.toolTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.toolDesc} tone="secondary">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

/* ── native Button stand-in (`@/components/ui` Button, variant primary size sm) ── */

function GenerateButton({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({pressed}) => [
        styles.generateButton,
        pressed && styles.generateButtonPressed,
      ]}
      testID="uuid-generate">
      <AppText style={styles.generateGlyph}>{glyph}</AppText>
      <AppText style={styles.generateLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── native-safe copy affordance (stand-in for `@/components/ui` CopyButton) ── */

/**
 * Best-effort clipboard write. Resolves true on success, false where no clipboard
 * module is available (a bare native device). Works on the web / react-native-web
 * target via navigator.clipboard.
 */
async function writeTextToClipboard(text: string): Promise<boolean> {
  const clipboard = (
    globalThis as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator?.clipboard;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function UuidCopyButton({text, testID}: {text: string; testID: string}) {
  // Preserve the CopyButton i18n defaults/keys (common.copyButton.copy/.copied).
  const copyLabel = 'Copy';
  const copiedLabel = 'Copied';
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const handlePress = useCallback(() => {
    void writeTextToClipboard(text);
    setCopied(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [text]);

  const label = copied ? copiedLabel : copyLabel;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={handlePress}
      style={({pressed}) => [
        styles.copyButton,
        pressed && styles.copyButtonPressed,
      ]}
      testID={testID}>
      <AppText style={[styles.copyGlyph, copied && styles.copyGlyphDone]}>
        {copied ? COPIED_GLYPH : COPY_GLYPH}
      </AppText>
      <AppText style={styles.copyLabel} testID={`${testID}-label`} tone="secondary">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   UuidGeneratorTool — generates v4 UUIDs (newest-first, capped at 10)
   ═══════════════════════════════════════════════════════════════════════ */

export function UuidGeneratorTool() {
  const t = useNativeTranslationFallback();
  const [uuids, setUuids] = useState<string[]>([]);

  const generate = useCallback(() => {
    /* safeRandomUUID covers non-secure-context / crypto-missing targets where
     * crypto.randomUUID is undefined. */
    const uuid = safeRandomUUID();
    setUuids(prev => [uuid, ...prev].slice(0, 10));
  }, []);

  return (
    <ToolCard
      color="purple"
      description={t('Uuid Generator Desc')}
      glyph={FINGERPRINT_GLYPH}
      title={t('Uuid Generator')}>
      <View style={styles.body}>
        <GenerateButton
          glyph={REFRESH_GLYPH}
          label={t('Generate')}
          onPress={generate}
        />
        {uuids.length > 0 ? (
          <View style={styles.list}>
            {uuids.map((u, i) => (
              <View key={`${u}-${i}`} style={styles.row} testID={`uuid-row-${i}`}>
                <AppText
                  numberOfLines={1}
                  style={styles.code}
                  testID={`uuid-value-${i}`}>
                  {u}
                </AppText>
                <UuidCopyButton testID={`uuid-copy-${i}`} text={u} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  toolCard: {
    padding: spacing.lg,
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  toolIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  toolHeaderText: {
    flex: 1,
    gap: 2,
  },
  toolTitle: {
    fontSize: typography.body,
  },
  toolDesc: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  body: {
    gap: spacing.md,
  },
  generateButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  generateButtonPressed: {
    opacity: 0.85,
  },
  generateGlyph: {
    fontSize: 13,
    color: colors.background,
  },
  generateLabel: {
    fontSize: typography.caption,
    color: colors.background,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 6,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  code: {
    flex: 1,
    fontSize: typography.caption,
    fontFamily: 'monospace',
    color: PURPLE_300,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
  },
  copyButtonPressed: {
    opacity: 0.7,
  },
  copyGlyph: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  copyGlyphDone: {
    color: colors.success,
  },
  copyLabel: {
    fontSize: typography.caption,
  },
});
