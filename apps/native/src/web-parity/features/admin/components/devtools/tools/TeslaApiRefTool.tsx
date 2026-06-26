// Native parity port of
// web/src/features/admin/components/devtools/tools/TeslaApiRefTool.tsx.
//
// The web tool is a developer reference card: a search box filters a static
// list of Tesla Fleet API endpoints (TESLA_ENDPOINTS) by HTTP method, path, or
// description, rendered in a DataTable with three columns — a method Badge
// (GET -> info, everything else -> warning), the path as monospace `code` with
// a CopyButton, and the endpoint description. It is reproduced here with React
// Native primitives, preserving the `search` state, the `filtered` useMemo
// (case-insensitive match on method/path/desc), the column header i18n keys,
// the Badge variant mapping, and the BookOpen cyan visual intent:
//
//   - `@/components/ui` Input (a DOM <input> with a leading icon) is
//     browser-only and becomes a `TextInput` with a leading "BK" glyph.
//     `onChange={e => setSearch(e.target.value)}` maps to `onChangeText`.
//   - `@/components/ui` Badge (a DOM <span>) becomes an inline native pill; the
//     web info/warning variants map to the cyan-accent / amber-warning token
//     tints, preserving `variant={r.method === 'GET' ? 'info' : 'warning'}`.
//   - `@/components/ui` DataTable (a DOM <table> with pagination + compact) is
//     browser-only and becomes a native header row + rows View. TESLA_ENDPOINTS
//     holds 11 rows, which is below the DataTable default page size (25), so the
//     `pagination` prop never engages and the full filtered list renders; the
//     `compact` density maps to the tighter native row paddings. The default
//     `emptyMessage` ("No data") is shown when the filter clears the list.
//   - `@/components/ui` CopyButton calls `navigator.clipboard.writeText`, which
//     is browser-only; it is reproduced as a native-safe copy control that
//     writes through a runtime-resolved `navigator.clipboard` (present under
//     react-native-web and the jest/web target, absent on a device) and only
//     shows the "Copied" state on a real write — otherwise it is an explicit
//     no-op, mirroring the PageHeader CopyLinkButton parity precedent. The
//     `common.copyButton.*` i18n keys and the 2000ms reset are preserved.
//   - lucide `BookOpen` (browser-only) becomes a compact "BK" glyph: rendered
//     cyan in the card badge (mirroring `color="cyan"` -> `ICON_COLOR_MAP.cyan`)
//     and muted as the search field's leading glyph.
//   - react-i18next `useTranslation` is not a native-parity dependency; a local
//     t() shim returns the fallback (the source passes the English copy as the
//     key, so the key is preserved verbatim as the visible string).
//   - `../ToolCard` (+ `ICON_COLOR_MAP`) and `../constants` `TESLA_ENDPOINTS`
//     are separate, not-yet-shared native targets in this file-by-file loop, so
//     a self-contained native ToolCard equivalent and the `TESLA_ENDPOINTS`
//     tuple are inlined here (the same inlining precedent set by the converted
//     ByteSizeConverter / devtools helpers.ts ports).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, TextInput, View} from 'react-native';

import {AppText} from '../../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../../theme/tokens';

/* ─── inlined Tesla endpoint reference (web `../constants`) ────────────────── */

interface TeslaEndpoint {
  method: string;
  path: string;
  desc: string;
}

const TESLA_ENDPOINTS: TeslaEndpoint[] = [
  {method: 'GET', path: '/api/1/vehicles', desc: 'List vehicles'},
  {
    method: 'GET',
    path: '/api/1/vehicles/{id}/vehicle_data',
    desc: 'Get vehicle data',
  },
  {
    method: 'POST',
    path: '/api/1/vehicles/{id}/command/wake_up',
    desc: 'Wake up vehicle',
  },
  {
    method: 'POST',
    path: '/api/1/vehicles/{id}/command/door_lock',
    desc: 'Lock doors',
  },
  {
    method: 'POST',
    path: '/api/1/vehicles/{id}/command/door_unlock',
    desc: 'Unlock doors',
  },
  {
    method: 'POST',
    path: '/api/1/vehicles/{id}/command/flash_lights',
    desc: 'Flash lights',
  },
  {
    method: 'POST',
    path: '/api/1/vehicles/{id}/command/honk_horn',
    desc: 'Honk horn',
  },
  {
    method: 'POST',
    path: '/api/1/vehicles/{id}/command/set_charge_limit',
    desc: 'Set charge limit',
  },
  {
    method: 'POST',
    path: '/api/1/vehicles/{id}/command/charge_start',
    desc: 'Start charging',
  },
  {
    method: 'POST',
    path: '/api/1/vehicles/{id}/command/charge_stop',
    desc: 'Stop charging',
  },
  {
    method: 'GET',
    path: '/api/1/vehicles/{id}/nearby_charging_sites',
    desc: 'Nearby chargers',
  },
];

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

/* ─── native-safe clipboard write (web `navigator.clipboard.writeText`) ────── */

interface ClipboardCapableNavigator {
  clipboard?: {writeText?: (value: string) => Promise<void>};
}

const COPIED_RESET_MS = 2000;

async function writeClipboard(text: string): Promise<boolean> {
  const nav = (globalThis as {navigator?: ClipboardCapableNavigator}).navigator;
  const clipboard = nav?.clipboard;
  if (typeof clipboard?.writeText !== 'function') {
    return false;
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ─── CopyButton equivalent (web `@/components/ui` CopyButton) ──────────────── */

function CopyButton({text}: {text: string}) {
  const t = useNativeTranslationFallback();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  const handlePress = useCallback(async () => {
    const ok = await writeClipboard(text);
    if (!ok) {
      return;
    }
    setCopied(true);
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [text]);

  const copyLabel = t('common.copyButton.copy', 'Copy');
  const copiedLabel = t('common.copyButton.copied', 'Copied');

  return (
    <Pressable
      accessibilityLabel={copied ? copiedLabel : copyLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={handlePress}
      style={({pressed}) => [styles.copyButton, pressed && styles.copyButtonPressed]}>
      <AppText style={styles.copyGlyph} tone="accent" variant="caption">
        {copied ? '\u2713' : '\u29C9'}
      </AppText>
    </Pressable>
  );
}

CopyButton.displayName = 'CopyButton';

/* ─── Badge equivalent (web `@/components/ui` Badge) ────────────────────────── */

type BadgeVariant = 'info' | 'warning';

function MethodBadge({variant, label}: {variant: BadgeVariant; label: string}) {
  return (
    <View style={[styles.badge, variant === 'info' ? styles.badgeInfo : styles.badgeWarning]}>
      <AppText
        style={variant === 'info' ? styles.badgeTextInfo : styles.badgeTextWarning}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

MethodBadge.displayName = 'MethodBadge';

/* ─── ToolCard equivalent (web `../ToolCard` + `ICON_COLOR_MAP`) ───────────── */

type ToolColor = 'cyan' | 'green' | 'purple' | 'amber' | 'red';

interface ToolTint {
  surface: string;
  border: string;
  glyph: string;
}

const TOOL_TINTS: Record<ToolColor, ToolTint> = {
  cyan: {
    surface: colors.accentSoft,
    border: colors.borderAccent,
    glyph: colors.accent,
  },
  green: {
    surface: colors.successSurface,
    border: colors.successBorder,
    glyph: colors.success,
  },
  purple: {
    surface: colors.violetSurface,
    border: colors.violetBorder,
    glyph: colors.violet,
  },
  amber: {
    surface: colors.warningSurface,
    border: colors.warningBorder,
    glyph: colors.warning,
  },
  red: {
    surface: colors.dangerSurface,
    border: colors.dangerBorder,
    glyph: colors.danger,
  },
};

interface ToolCardProps {
  iconGlyph: string;
  color: ToolColor;
  title: string;
  description: string;
  children: ReactNode;
}

function ToolCard({iconGlyph, color, title, description, children}: ToolCardProps) {
  const tint = TOOL_TINTS[color] ?? TOOL_TINTS.cyan;
  return (
    <GlassPanel style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.iconBadge,
            {backgroundColor: tint.surface, borderColor: tint.border},
          ]}>
          <AppText style={[styles.iconBadgeGlyph, {color: tint.glyph}]} weight="bold">
            {iconGlyph}
          </AppText>
        </View>
        <View style={styles.cardHeaderText}>
          <AppText variant="body" weight="semibold">
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

ToolCard.displayName = 'ToolCard';

/* ─── TeslaApiRefTool ──────────────────────────────────────────────────────── */

export function TeslaApiRefTool() {
  const t = useNativeTranslationFallback();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return TESLA_ENDPOINTS;
    }
    const q = search.toLowerCase();
    return TESLA_ENDPOINTS.filter(
      e =>
        e.method.toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <ToolCard
      iconGlyph="BK"
      color="cyan"
      title={t('Tesla Api Ref')}
      description={t('Tesla Api Ref Desc')}>
      <View style={styles.body}>
        <View style={styles.inputRow}>
          <AppText style={styles.inputIcon} tone="muted" variant="caption" weight="bold">
            BK
          </AppText>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder={t('Search Endpoints')}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={search}
          />
        </View>

        <View style={styles.table}>
          <View style={styles.headerRow}>
            <AppText
              style={[styles.headCell, styles.methodCol]}
              tone="muted"
              variant="caption"
              weight="semibold">
              {t('Method')}
            </AppText>
            <AppText
              style={[styles.headCell, styles.pathCol]}
              tone="muted"
              variant="caption"
              weight="semibold">
              {t('Path')}
            </AppText>
            <AppText
              style={[styles.headCell, styles.descCol]}
              tone="muted"
              variant="caption"
              weight="semibold">
              {t('Endpoint Desc')}
            </AppText>
          </View>

          {filtered.length === 0 ? (
            <View style={styles.emptyRow}>
              <AppText tone="muted" variant="caption">
                {t('No data')}
              </AppText>
            </View>
          ) : (
            filtered.map(r => (
              <View key={r.path} style={styles.row}>
                <View style={styles.methodCol}>
                  <MethodBadge variant={r.method === 'GET' ? 'info' : 'warning'} label={r.method} />
                </View>
                <View style={[styles.pathCol, styles.pathCell]}>
                  <AppText numberOfLines={1} style={styles.pathCode}>
                    {r.path}
                  </AppText>
                  <CopyButton text={r.path} />
                </View>
                <AppText
                  style={styles.descCol}
                  tone="secondary"
                  variant="caption">
                  {r.desc}
                </AppText>
              </View>
            ))
          )}
        </View>
      </View>
    </ToolCard>
  );
}

TeslaApiRefTool.displayName = 'TeslaApiRefTool';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeInfo: {
    backgroundColor: colors.accentSoft,
  },
  badgeTextInfo: {
    color: colors.accent,
  },
  badgeTextWarning: {
    color: colors.warning,
  },
  badgeWarning: {
    backgroundColor: colors.warningSurface,
  },
  body: {
    gap: spacing.md,
  },
  card: {
    padding: spacing.lg,
  },
  cardDesc: {
    marginTop: 2,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeaderText: {
    flexShrink: 1,
  },
  copyButton: {
    alignItems: 'center',
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  copyButtonPressed: {
    opacity: 0.6,
  },
  copyGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  descCol: {
    color: colors.textSecondary,
    flex: 1.1,
  },
  emptyRow: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  headCell: {
    letterSpacing: 0.3,
  },
  headerRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconBadgeGlyph: {
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    padding: 0,
  },
  inputIcon: {
    letterSpacing: 0.4,
    marginRight: spacing.sm,
  },
  inputRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  methodCol: {
    width: 54,
  },
  pathCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pathCode: {
    color: colors.accent,
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
  },
  pathCol: {
    flex: 1.5,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  table: {
    gap: 0,
  },
});
