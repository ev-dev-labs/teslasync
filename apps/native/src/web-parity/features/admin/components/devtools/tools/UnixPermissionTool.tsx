// Native parity port of web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx.
//
// A Dev Tools utility card: the user types a 3-digit octal mode (or taps a
// preset), and the card renders the symbolic rwx string split into Owner / Group
// / Other triads plus the combined string with a copy affordance. The whole thing
// is pure client-side computation — there is no API call, no DOM-only behaviour,
// and no browser-only dependency beyond the clipboard, so the logic ports 1:1 to
// React Native.
//
// The web source composes three things this native target cannot import directly:
//   - ../ToolCard           (a devtools-local wrapper — NOT a separate parity target)
//   - ../constants PERMS     (a tiny octal→rwx map — NOT a parity target)
//   - @/components/ui Input/Select/CopyButton + the lucide Lock SVG
// Mirroring the established sibling CronParser.tsx / InfrastructureSection.tsx
// precedent for this folder, the port is SELF-CONTAINED: ToolCard, the labelled
// Input, the Presets selector and the CopyButton are reproduced natively in this
// one file, and the PERMS map is inlined verbatim from web ../constants (plain TS,
// no DOM). State name (octal), the derived `symbolic` memo logic, the six preset
// options, and every i18n key are preserved exactly.
//
// Native-safe adaptations (documented in the sidecar):
//   - The lucide Lock icon (header + Input leading icon) has no native SVG analog
//     here, so it becomes a short "LK" glyph inside the same web ICON_COLOR_MAP
//     green ring (header) / a muted leading glyph (input), matching the sibling
//     CronParser/InfrastructureSection glyph language.
//   - The shared web ui (GlassPanel/Input/Select/CopyButton) and DOM elements
//     (div/span/p/code/input/select) are replaced by the shared native GlassPanel +
//     RN View/TextInput/Pressable + AppText against the theme tokens.
//   - The web <select> Presets dropdown becomes a labelled row of single-select
//     preset chips (Pressable) whose selected chip reflects the dropdown's
//     value={octal} binding; tapping a chip runs setOctal(value), preserving the
//     options/value/onChange semantics of the source Select.
//   - react-i18next is not wired in native, so useTranslation()'s `t` is replaced
//     by a native fallback returning the i18n key (i18next returns the key for a
//     missing translation, so t('Unix Perm') -> 'Unix Perm') or the supplied
//     English default (t('common.copyButton.copy', 'Copy')), preserving every key.
//   - The web CopyButton's navigator.clipboard.writeText is reproduced with a
//     native-safe writeClipboard that uses navigator.clipboard when present
//     (react-native-web) and degrades to an explicit unavailable state on
//     iOS/Android where no clipboard module is bundled.
//
// No DOM, Recharts, Leaflet, lucide-react, or old web ui components are imported.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../../../theme/tokens';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback?: string) => string;

// react-i18next is not wired in native. i18next returns the key itself when a
// translation is missing, so the fallback returns the key (web t('Octal Perm')
// -> 'Octal Perm') or the supplied English default, preserving every key.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

/* ─── unix permission map (web-parity of ../constants PERMS) ──────────── */

const PERMS: Record<string, string> = {
  '7': 'rwx',
  '6': 'rw-',
  '5': 'r-x',
  '4': 'r--',
  '3': '-wx',
  '2': '-w-',
  '1': '--x',
  '0': '---',
};

/* ─── clipboard (web-parity of the shared CopyButton) ─────────────────── */

type CopyState = 'idle' | 'copied' | 'unavailable';

// Native-safe clipboard writer. Uses navigator.clipboard.writeText when present
// (react-native-web); on iOS/Android no clipboard module is bundled yet, so the
// copy is reported unavailable rather than crashing. Mirrors the web CopyButton's
// behaviour of not flipping to "Copied" when the write fails.
async function writeClipboard(text: string): Promise<CopyState> {
  const nav = globalThis as {
    navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
  };
  const clipboard = nav.navigator?.clipboard;
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    return 'unavailable';
  }
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'idle';
  }
}

function CopyControl({text}: {text: string}) {
  const t = useNativeTranslationFallback();
  const [state, setState] = useState<CopyState>('idle');

  const handleCopy = useCallback(async () => {
    const outcome = await writeClipboard(text);
    setState(outcome);
    if (outcome === 'copied') {
      setTimeout(() => setState('idle'), 2000);
    }
  }, [text]);

  const copied = state === 'copied';
  const unavailable = state === 'unavailable';
  const label = copied
    ? t('common.copyButton.copied', 'Copied')
    : t('common.copyButton.copy', 'Copy');
  const hint = unavailable
    ? t('common.copyButton.unavailable', 'Copy is unavailable on this device')
    : undefined;

  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="button"
      hitSlop={8}
      onPress={handleCopy}
      style={({pressed}) => [styles.copyButton, pressed && styles.pressed]}>
      <AppText
        accessible={false}
        allowFontScaling={false}
        style={styles.copyGlyph}>
        {copied ? 'OK' : 'CP'}
      </AppText>
      <AppText style={styles.copyLabel} tone="secondary" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── ToolCard (web-parity of ../ToolCard, green variant) ─────────────── */

interface ToolCardProps {
  glyph: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

function ToolCard({glyph, title, description, children}: ToolCardProps) {
  return (
    <GlassPanel style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconBox}>
          <AppText
            accessible={false}
            allowFontScaling={false}
            style={styles.iconGlyph}
            weight="bold">
            {glyph}
          </AppText>
        </View>
        <View style={styles.cardHeaderText}>
          <AppText style={styles.cardTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.cardDescription} tone="secondary">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

/* ─── PresetChip (web-parity of a single <Select> <option>) ───────────── */

function PresetChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected}}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.preset,
        selected && styles.presetSelected,
        pressed && styles.pressed,
      ]}>
      <AppText
        style={[styles.presetLabel, selected && styles.presetLabelSelected]}
        tone={selected ? 'primary' : 'secondary'}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Unix Permission Tool
   ═══════════════════════════════════════════════════════════════════════ */

export interface UnixPermissionToolProps {
  /** Native style applied to the card wrapper (replaces the web className slot). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function UnixPermissionTool({
  style,
  testID,
}: UnixPermissionToolProps = {}) {
  const t = useNativeTranslationFallback();
  const [octal, setOctal] = useState('755');

  const symbolic = useMemo(() => {
    if (octal.length !== 3 || !/^[0-7]{3}$/.test(octal)) {
      return null;
    }
    return (
      (PERMS[octal[0] ?? '0'] ?? '---') +
      (PERMS[octal[1] ?? '0'] ?? '---') +
      (PERMS[octal[2] ?? '0'] ?? '---')
    );
  }, [octal]);

  const presetOptions = [
    {value: '755', label: '755 (rwxr-xr-x)'},
    {value: '644', label: '644 (rw-r--r--)'},
    {value: '700', label: '700 (rwx------)'},
    {value: '600', label: '600 (rw-------)'},
    {value: '777', label: '777 (rwxrwxrwx)'},
    {value: '444', label: '444 (r--r--r--)'},
  ];

  return (
    <View style={style} testID={testID ?? 'unix-permission-tool'}>
      <ToolCard
        glyph="LK"
        title={t('Unix Perm')}
        description={t('Unix Perm Desc')}>
        <View style={styles.body}>
          <View style={styles.field}>
            <AppText style={styles.fieldLabel} tone="secondary">
              {t('Octal Perm')}
            </AppText>
            <View style={styles.inputRow}>
              <AppText
                accessible={false}
                allowFontScaling={false}
                style={styles.inputGlyph}
                tone="muted">
                LK
              </AppText>
              <TextInput
                accessibilityLabel={t('Octal Perm')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                maxLength={3}
                onChangeText={setOctal}
                placeholder="755"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={octal}
              />
            </View>
          </View>

          <View style={styles.field}>
            <AppText style={styles.fieldLabel} tone="secondary">
              {t('Presets')}
            </AppText>
            <View style={styles.presetRow}>
              {presetOptions.map(opt => (
                <PresetChip
                  key={opt.value}
                  label={opt.label}
                  onPress={() => setOctal(opt.value)}
                  selected={octal === opt.value}
                />
              ))}
            </View>
          </View>

          {symbolic ? (
            <View style={styles.permRow}>
              <View style={styles.permBox}>
                <AppText style={styles.permLabel} tone="secondary">
                  {t('Owner')}
                </AppText>
                <AppText style={[styles.permValue, styles.permValueOwner]}>
                  {symbolic.slice(0, 3)}
                </AppText>
              </View>
              <View style={styles.permBox}>
                <AppText style={styles.permLabel} tone="secondary">
                  {t('Group')}
                </AppText>
                <AppText style={[styles.permValue, styles.permValueGroup]}>
                  {symbolic.slice(3, 6)}
                </AppText>
              </View>
              <View style={styles.permBox}>
                <AppText style={styles.permLabel} tone="secondary">
                  {t('Other')}
                </AppText>
                <AppText style={[styles.permValue, styles.permValueOther]}>
                  {symbolic.slice(6)}
                </AppText>
              </View>
            </View>
          ) : null}

          {symbolic ? (
            <View style={styles.codeRow}>
              <AppText style={styles.codeText}>{symbolic}</AppText>
              <CopyControl text={symbolic} />
            </View>
          ) : null}
        </View>
      </ToolCard>
    </View>
  );
}

UnixPermissionTool.displayName = 'UnixPermissionTool';

export default UnixPermissionTool;

/* ─── styles ──────────────────────────────────────────────────────────── */

const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

// web --surface-overlay (dark theme): rgba(15, 23, 42, 0.5)
const SURFACE_OVERLAY = 'rgba(15, 23, 42, 0.5)';
// web Input bg approximation (matches sibling CronParser/InfrastructureSection)
const INPUT_BG = 'rgba(255, 255, 255, 0.04)';
// web ICON_COLOR_MAP.green ring (bg-neon-green/10 ring-neon-green/20)
const GREEN_RING_BG = 'rgba(52, 211, 153, 0.10)';
const GREEN_RING_BORDER = 'rgba(52, 211, 153, 0.20)';
// web text-emerald-300 / text-cyan-300 / text-amber-300
const EMERALD_300 = '#6ee7b7';
const CYAN_300 = '#67e8f9';
const AMBER_300 = '#fcd34d';

const styles = StyleSheet.create({
  // web ToolCard: <GlassPanel className="p-5">
  card: {
    padding: spacing.lg,
  },
  // web: mb-4 flex items-start gap-3
  cardHeader: {
    columnGap: spacing.md,
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  // web: h-10 w-10 shrink-0 rounded-lg + ICON_COLOR_MAP.green ring
  iconBox: {
    alignItems: 'center',
    backgroundColor: GREEN_RING_BG,
    borderColor: GREEN_RING_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    color: colors.success,
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  cardHeaderText: {
    flex: 1,
  },
  // web: text-sm font-semibold text-white
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  // web: text-xs text-[var(--text-secondary)]
  cardDescription: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  // web: <div className="space-y-3">
  body: {
    rowGap: spacing.md,
  },
  field: {
    rowGap: spacing.xs,
  },
  // web Input/Select label: text-sm font-medium text-[var(--text-secondary)]
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  // web Input md w/ leading icon: border + bg-surface-1 + pl-10
  inputRow: {
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  inputGlyph: {
    fontSize: 11,
    letterSpacing: 0.4,
    marginRight: spacing.sm,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    paddingVertical: spacing.sm,
  },
  // web Select Presets: a row of single-select chips (flex-wrap)
  presetRow: {
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  preset: {
    backgroundColor: SURFACE_OVERLAY,
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  presetSelected: {
    backgroundColor: GREEN_RING_BG,
    borderColor: GREEN_RING_BORDER,
  },
  presetLabel: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  presetLabelSelected: {
    color: EMERALD_300,
  },
  pressed: {
    opacity: 0.7,
  },
  // web: grid gap-2 sm:grid-cols-3 (Owner / Group / Other triads)
  permRow: {
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  // web: rounded bg-[var(--surface-overlay)] px-3 py-2 text-center
  permBox: {
    alignItems: 'center',
    backgroundColor: SURFACE_OVERLAY,
    borderRadius: 8,
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // web: text-xs text-[var(--text-secondary)]
  permLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  // web: font-mono text-sm
  permValue: {
    fontFamily: MONO_FONT,
    fontSize: 14,
    lineHeight: 18,
    marginTop: 2,
  },
  permValueOwner: {
    color: EMERALD_300,
  },
  permValueGroup: {
    color: CYAN_300,
  },
  permValueOther: {
    color: AMBER_300,
  },
  // web: flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-2
  codeRow: {
    alignItems: 'center',
    backgroundColor: SURFACE_OVERLAY,
    borderRadius: 8,
    columnGap: spacing.sm,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // web: text-sm font-mono text-white
  codeText: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily: MONO_FONT,
    fontSize: 14,
    lineHeight: 18,
  },
  // web CopyButton (ghost/sm)
  copyButton: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  copyGlyph: {
    color: colors.textSecondary,
    fontSize: 10,
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  copyLabel: {
    fontSize: 11,
    lineHeight: 15,
  },
});
