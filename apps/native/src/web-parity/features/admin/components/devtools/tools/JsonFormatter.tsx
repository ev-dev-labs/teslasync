// Native parity port of
// web/src/features/admin/components/devtools/tools/JsonFormatter.tsx.
//
// A self-contained DevTools widget: paste arbitrary JSON, see it either
// pretty-printed (2-space indent) or the parser error, with a one-tap copy of
// the formatted output. The pure logic — the empty-input short-circuit,
// JSON.parse -> JSON.stringify(parsed, null, 2), and the error-message routing
// (Error.message, else the i18n "Invalid Json" fallback) — is preserved
// verbatim, including the `inputVal` state name, the `result` useMemo value
// shape ({formatted, error}), and the [inputVal, t] dependency array.
//
// Web dependencies absent from the native parity manifest are made native-safe
// (contract rules 4, 5 & 7) and documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L2) -> inlined useNativeTranslation():
//     a stable (key, fallback?) => fallback ?? key shim, so the original
//     single-arg t('Json Formatter') calls keep their English key as the
//     display string and i18n intent is preserved at the call site.
//   - lucide-react `Braces` (web L3) -> rendered as the `{ }` glyph inside the
//     ToolCard icon chip (lucide Braces literally depicts curly braces); the
//     established native vocabulary already carries lucide identities as data
//     (cf. web-parity/.../devtools/constants.ts).
//   - `@/components/ui` Textarea (web L4) -> React Native multiline <TextInput>
//     (rows={4} -> numberOfLines={4} + min height), same value + placeholder.
//   - `../ToolCard` (web L5): native sibling not yet ported, so a native-safe
//     ToolCard equivalent is inlined here (GlassPanel + colored icon chip +
//     title/description + children), resolving the `color="green"` prop through
//     ICON_COLOR_TOKENS from the already-ported ../constants module, mirroring
//     the web `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan` default.
//   - `@/components/ui` CopyButton (web L6): native sibling not ported, so a
//     native-safe CopyButton is inlined. The browser-only
//     navigator.clipboard.writeText is feature-detected at runtime (present on
//     react-native-web, absent on bare native); when unavailable the button
//     surfaces an explicit "Unavailable" state instead of silently failing, and
//     the success path mirrors the web Copy -> Copied -> (2s) -> Copy cycle.
//
// CSS vars/Tailwind map to tokens: --text-secondary -> textSecondary,
// --text-muted -> textMuted, --surface-overlay -> surfaceGlass, text-rose-300
// -> colors.danger, text-emerald-300 -> colors.success. No DOM-only modules,
// HTML elements, Recharts, Leaflet, or web UI components are imported — only
// react, react-native primitives, and existing apps/native SemanticIcon /
// AppText / GlassPanel / theme tokens.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../../theme/tokens';
import {ICON_COLOR_TOKENS} from '../constants';

type NativeTFunction = (key: string, fallback?: string) => string;

type IconColorKey = 'cyan' | 'green' | 'purple' | 'amber' | 'red';

type CopyStatus = 'idle' | 'copied' | 'unavailable';

type ClipboardWriter = (value: string) => Promise<boolean>;

const FALLBACK_ICON_COLOR: IconColorKey = 'cyan';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

// react-i18next useTranslation replacement: returns the English fallback, or
// the key itself when the source called t() with a single argument.
function useNativeTranslation(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

// Mirrors the web ToolCard `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan` default.
function resolveIconColor(color: string): IconColorKey {
  return color in ICON_COLOR_TOKENS
    ? (color as IconColorKey)
    : FALLBACK_ICON_COLOR;
}

// Feature-detects the browser clipboard (available under react-native-web,
// absent on bare native). Returns null when no writer exists so the caller can
// surface an explicit unavailable state instead of a silent failure.
function getClipboardWriter(): ClipboardWriter | null {
  const nav = (
    globalThis as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator;
  const clipboard = nav?.clipboard;
  const writeText = clipboard?.writeText;
  if (typeof writeText !== 'function') {
    return null;
  }
  return async (value: string) => {
    try {
      await writeText.call(clipboard, value);
      return true;
    } catch {
      return false;
    }
  };
}

function copyLabelFor(status: CopyStatus, t: NativeTFunction): string {
  if (status === 'copied') {
    return t('common.copyButton.copied', 'Copied');
  }
  if (status === 'unavailable') {
    return t('common.copyButton.unavailable', 'Unavailable');
  }
  return t('common.copyButton.copy', 'Copy');
}

function CopyButton({text}: {text: string}) {
  const t = useNativeTranslation();
  const [status, setStatus] = useState<CopyStatus>('idle');
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current) {
        clearTimeout(resetRef.current);
      }
    };
  }, []);

  const scheduleReset = useCallback(() => {
    if (resetRef.current) {
      clearTimeout(resetRef.current);
    }
    resetRef.current = setTimeout(() => setStatus('idle'), 2000);
  }, []);

  const handleCopy = useCallback(() => {
    const writer = getClipboardWriter();
    if (!writer) {
      setStatus('unavailable');
      scheduleReset();
      return;
    }
    void writer(text).then(ok => {
      setStatus(ok ? 'copied' : 'unavailable');
      scheduleReset();
    });
  }, [scheduleReset, text]);

  const label = copyLabelFor(status, t);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={4}
      onPress={handleCopy}
      style={({pressed}) => [styles.copyButton, pressed && styles.pressed]}>
      <SemanticIcon
        decorative
        name={status === 'copied' ? 'confirm' : 'copy'}
        size="sm"
        style={styles.copyIcon}
      />
      <AppText
        style={styles.copyLabel}
        tone="secondary"
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

interface ToolCardProps {
  color: string;
  iconGlyph: string;
  title: string;
  description: string;
  children: ReactNode;
}

function ToolCard({
  color,
  iconGlyph,
  title,
  description,
  children,
}: ToolCardProps) {
  const colorKey = resolveIconColor(color);
  return (
    <GlassPanel style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconChip, chipSurfaceStyles[colorKey]]}>
          <AppText
            style={[styles.iconGlyph, chipGlyphStyles[colorKey]]}
            weight="bold">
            {iconGlyph}
          </AppText>
        </View>
        <View style={styles.headerText}>
          <AppText style={styles.title} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.description} tone="secondary" variant="caption">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

export function JsonFormatterTool() {
  const t = useNativeTranslation();
  const [inputVal, setInputVal] = useState('');
  const result = useMemo(() => {
    if (!inputVal.trim()) {
      return {formatted: '', error: ''};
    }
    try {
      const parsed = JSON.parse(inputVal) as unknown;
      return {formatted: JSON.stringify(parsed, null, 2), error: ''};
    } catch (e) {
      return {
        formatted: '',
        error: e instanceof Error ? e.message : t('Invalid Json'),
      };
    }
  }, [inputVal, t]);

  return (
    <ToolCard
      color="green"
      description={t('Json Formatter Desc')}
      iconGlyph="{ }"
      title={t('Json Formatter')}>
      <View style={styles.body}>
        <View>
          <AppText
            style={styles.fieldLabel}
            tone="secondary"
            variant="caption"
            weight="semibold">
            {t('Json Input')}
          </AppText>
          <TextInput
            multiline
            numberOfLines={4}
            onChangeText={setInputVal}
            placeholder='{"key":"value"}'
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            textAlignVertical="top"
            value={inputVal}
          />
        </View>
        {result.error ? (
          <AppText style={styles.errorText}>{result.error}</AppText>
        ) : null}
        {result.formatted ? (
          <View style={styles.formattedBlock}>
            <View style={styles.formattedHeader}>
              <AppText tone="secondary" variant="caption">
                {t('Formatted')}
              </AppText>
              <CopyButton text={result.formatted} />
            </View>
            <ScrollView
              style={styles.formattedScroll}
              contentContainerStyle={styles.formattedContent}>
              <AppText style={styles.formattedText}>{result.formatted}</AppText>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </ToolCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: 16,
  },
  iconChip: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  description: {
    marginTop: 2,
  },
  body: {
    gap: spacing.md,
  },
  fieldLabel: {
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  formattedBlock: {
    backgroundColor: colors.surfaceGlass,
    borderRadius: 8,
    padding: spacing.md,
  },
  formattedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  formattedScroll: {
    marginTop: spacing.xs,
    maxHeight: 256,
  },
  formattedContent: {
    paddingVertical: 2,
  },
  formattedText: {
    color: colors.success,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  copyButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  copyIcon: {
    borderWidth: 0,
  },
  copyLabel: {
    letterSpacing: 0.2,
  },
  pressed: {
    opacity: 0.82,
  },
});

const chipSurfaceStyles = StyleSheet.create<Record<IconColorKey, ViewStyle>>({
  cyan: {
    backgroundColor: ICON_COLOR_TOKENS.cyan.bg,
    borderColor: ICON_COLOR_TOKENS.cyan.ring,
  },
  green: {
    backgroundColor: ICON_COLOR_TOKENS.green.bg,
    borderColor: ICON_COLOR_TOKENS.green.ring,
  },
  purple: {
    backgroundColor: ICON_COLOR_TOKENS.purple.bg,
    borderColor: ICON_COLOR_TOKENS.purple.ring,
  },
  amber: {
    backgroundColor: ICON_COLOR_TOKENS.amber.bg,
    borderColor: ICON_COLOR_TOKENS.amber.ring,
  },
  red: {
    backgroundColor: ICON_COLOR_TOKENS.red.bg,
    borderColor: ICON_COLOR_TOKENS.red.ring,
  },
});

const chipGlyphStyles = StyleSheet.create<Record<IconColorKey, TextStyle>>({
  cyan: {
    color: ICON_COLOR_TOKENS.cyan.fg,
  },
  green: {
    color: ICON_COLOR_TOKENS.green.fg,
  },
  purple: {
    color: ICON_COLOR_TOKENS.purple.fg,
  },
  amber: {
    color: ICON_COLOR_TOKENS.amber.fg,
  },
  red: {
    color: ICON_COLOR_TOKENS.red.fg,
  },
});
