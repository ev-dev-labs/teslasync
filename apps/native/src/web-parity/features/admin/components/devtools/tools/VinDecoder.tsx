// Native parity port of
// web/src/features/admin/components/devtools/tools/VinDecoder.tsx.
//
// A self-contained DevTools widget: type a Tesla VIN and, once at least 11
// characters are present, see the manufacturer / model / drivetrain / year /
// plant decoded from the static VIN_* lookup tables, plus the trailing serial.
// The pure logic is preserved verbatim — the `vin` state name, the early
// `vin.length < 11 -> null` guard, the `upper = vin.toUpperCase()` derivation,
// each `VIN_*[upper[i] ?? ''] ?? t('Unknown')` lookup, `serial = upper.slice(11)`,
// the returned `{mfr, model, drive, year, plant, serial}` shape, the
// `Object.entries(decoded).map(...)` render, and the [vin, t] useMemo dependency
// array all match the source exactly.
//
// Web dependencies absent from the native parity manifest are made native-safe
// (contract rules 4, 5 & 7) and documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L2) -> inlined useNativeTranslation():
//     a stable (key, fallback?) => fallback ?? key shim (the established native
//     pattern, cf. the JsonFormatter sibling). Single-arg t('Vin Decoder') /
//     t('Vin') / t('Unknown') calls therefore keep their English key as the
//     display string, preserving i18n intent.
//   - lucide-react `Car` (web L3) -> the vehicle is the SemanticIcon 'vehicle'
//     identity (glyph "EV") in the native icon vocabulary: rendered as the
//     ToolCard header chip glyph and, borderless/transparent, as the input's
//     leading icon (the web `<Car className="h-4 w-4" />` prefix).
//   - `@/components/ui` Input (web L4) -> a labelled React Native <TextInput>
//     row (leading icon + field) with the same label, placeholder, controlled
//     value, and onChange->onChangeText binding. autoCapitalize="none" mirrors
//     the web <input> (no auto-capitalisation; case folding stays in the memo).
//   - `../ToolCard` (web L5): native sibling not yet ported, so a native-safe
//     ToolCard equivalent is inlined here (GlassPanel + colored icon chip +
//     title/description + children), resolving the `color="cyan"` prop through
//     ICON_COLOR_TOKENS from the already-ported ../constants module, mirroring
//     the web `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan` default.
//
// The dynamic `t(`devtools.utils.vin_${k}`)` field labels (web L37) reference
// keys that do NOT exist in the i18n catalog (devtools.utils only defines
// base64 / base64Desc / computeSha256), so the web renders the raw key string.
// To honor the panel's visual + i18n intent the native port supplies the
// intended English label through the shim's fallback argument while keeping the
// exact `devtools.utils.vin_${k}` key string at the call site.
//
// CSS vars/Tailwind map to tokens: --text-secondary -> textSecondary,
// --text-muted -> textMuted, --surface-overlay -> surfaceGlass, text-white ->
// colors.textPrimary. No DOM-only modules, HTML elements, Recharts, Leaflet, or
// web UI components are imported — only react, react-native primitives, and
// existing apps/native SemanticIcon / AppText / GlassPanel / theme tokens.

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
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
import {
  ICON_COLOR_TOKENS,
  VIN_DRIVE,
  VIN_MANUFACTURERS,
  VIN_MODELS,
  VIN_PLANT,
  VIN_YEAR,
} from '../constants';

type NativeTFunction = (key: string, fallback?: string) => string;

type IconColorKey = 'cyan' | 'green' | 'purple' | 'amber' | 'red';

const FALLBACK_ICON_COLOR: IconColorKey = 'cyan';

// Human-readable fallbacks for the dynamic `devtools.utils.vin_<field>` keys,
// which are absent from the i18n catalog. Keyed by the decoded field name so the
// label intent is preserved without hard-coding English at the JSX call site.
const VIN_FIELD_LABELS: Record<string, string> = {
  mfr: 'Manufacturer',
  model: 'Model',
  drive: 'Drivetrain',
  year: 'Year',
  plant: 'Plant',
  serial: 'Serial',
};

// react-i18next useTranslation replacement: returns the English fallback, or the
// key itself when the source called t() with a single argument.
function useNativeTranslation(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

// Mirrors the web ToolCard `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan` default.
function resolveIconColor(color: string): IconColorKey {
  return color in ICON_COLOR_TOKENS
    ? (color as IconColorKey)
    : FALLBACK_ICON_COLOR;
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

export function VinDecoderTool() {
  const t = useNativeTranslation();
  const [vin, setVin] = useState('');
  const decoded = useMemo(() => {
    if (vin.length < 11) {
      return null;
    }
    const upper = vin.toUpperCase();
    const mfr = VIN_MANUFACTURERS[upper.slice(0, 3)] ?? t('Unknown');
    const model = VIN_MODELS[upper[3] ?? ''] ?? t('Unknown');
    const drive = VIN_DRIVE[upper[7] ?? ''] ?? t('Unknown');
    const year = VIN_YEAR[upper[9] ?? ''] ?? t('Unknown');
    const plant = VIN_PLANT[upper[10] ?? ''] ?? t('Unknown');
    const serial = upper.slice(11);
    return {mfr, model, drive, year, plant, serial};
  }, [vin, t]);

  return (
    <ToolCard
      color="cyan"
      description={t('Vin Decoder Desc')}
      iconGlyph="EV"
      title={t('Vin Decoder')}>
      <View style={styles.body}>
        <View>
          <AppText
            style={styles.fieldLabel}
            tone="secondary"
            variant="caption"
            weight="semibold">
            {t('Vin')}
          </AppText>
          <View style={styles.inputRow}>
            <SemanticIcon
              decorative
              name="vehicle"
              size="sm"
              style={styles.inputIcon}
            />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setVin}
              placeholder="5YJ3E1EA1NF000001"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={vin}
            />
          </View>
        </View>
        {decoded ? (
          <View style={styles.grid}>
            {Object.entries(decoded).map(([k, v]) => (
              <View key={k} style={styles.cell}>
                <AppText tone="secondary" variant="caption">
                  {t(`devtools.utils.vin_${k}`, VIN_FIELD_LABELS[k] ?? k)}
                </AppText>
                <AppText style={styles.cellValue} weight="semibold">
                  {v}
                </AppText>
              </View>
            ))}
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
    fontSize: 16,
    letterSpacing: 0.5,
    lineHeight: 20,
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
  inputRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  inputIcon: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cell: {
    backgroundColor: colors.surfaceGlass,
    borderRadius: 8,
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 140,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cellValue: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
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
