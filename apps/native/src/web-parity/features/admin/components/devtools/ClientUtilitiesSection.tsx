/**
 * Native parity port of
 * web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx.
 *
 * The web file is the DevTools "Client Utilities" section: a searchable grid of
 * 15 client-side developer tools, each rendered inside an expandable GlassPanel
 * accordion card (single-open). This native port preserves the section's own
 * responsibilities 1:1 — the tool registry (id / name / desc / icon / color),
 * the search box + case-insensitive name|desc filter, the single-open
 * expand/collapse accordion, and the "no tools match" empty state — using React
 * Native primitives + the existing native AppText / GlassPanel / design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation`: replaced by a native-safe `t(key, def?)`
 *     fallback that returns the English default (or the key itself when the web
 *     call omitted one), keeping every translation key + i18n intent.
 *   - lucide-react icons (Car / Key / Clock / Braces / Link / Fingerprint /
 *     Hash / HardDrive / Palette / Timer / Network / BookOpen / Regex / Lock /
 *     ChevronDown): rendered as decorative `AppText` glyphs via `ICON_GLYPH`.
 *     The icon's semantic identity is preserved by the icon-name key (so
 *     base64 + json keep the shared "Braces" icon); the exact glyph is a
 *     non-critical decorative stand-in — the established native approach for
 *     inline lucide icons.
 *   - `@/components/ui` Button / Input: no native parity port yet, so minimal
 *     native-safe equivalents are reproduced locally (a `Pressable` accordion
 *     header in place of the ghost `Button`, a RN `TextInput` search field in
 *     place of `Input`). `GlassPanel` maps to the native `GlassPanel`.
 *   - `@/lib/cn`: dropped — native styling uses `StyleSheet` + tokens.
 *   - `./constants` `ICON_COLOR_MAP`: the web value is a Tailwind class string
 *     (`bg-neon-{c}/10 text-neon-{c} ring-1 ring-neon-{c}/20`). Tailwind cannot
 *     apply on native, so the five colours are reproduced locally as native
 *     chip styles ({backgroundColor, color, borderColor}) mapped to the
 *     equivalent design tokens (cyan→accent, green→success, purple→violet,
 *     amber→warning, red→danger), preserving the tinted-bg + tinted-text + ring
 *     intent.
 *   - The web responsive `grid-cols-1 md:2 lg:3` becomes a single-column native
 *     stack (the natural phone layout analog of the responsive grid).
 *   - The 15 tool body components (`./tools/*`): each tool is a separate web
 *     module with its own conversion lifecycle (HttpStatusTool + UuidGenerator
 *     are later parity-manifest entries; the other 13 are out of native parity
 *     scope) and is NOT this section's responsibility. Mirroring the App.tsx
 *     parity precedent — which represents unconverted page bodies as an explicit
 *     status panel rather than importing them — each expanded card body renders
 *     a native-safe `ToolUnavailableBody` that names the tool and reports its
 *     interactive UI as not yet available in native parity (explicit unavailable
 *     state).
 */
import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, TextInput, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../../theme/tokens';

/* ── native translation fallback (native-safe port of react-i18next) ── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: returns the English default, else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key: string, fallback?: string) => fallback ?? key,
    [],
  );
}

/* ── icon colour map (native-safe port of `./constants` ICON_COLOR_MAP) ── */

interface IconChipStyle {
  backgroundColor: string;
  color: string;
  borderColor: string;
}

/** The web Tailwind `bg/10 text ring/20` chip classes, mapped to native tokens. */
export const ICON_COLOR_MAP: Record<string, IconChipStyle> = {
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

/* ── decorative glyph stand-ins for the lucide-react icons ── */

const ICON_GLYPH: Record<string, string> = {
  Car: '\u25C9',
  Key: '\u26BF',
  Clock: '\u23F1',
  Braces: '{ }',
  Link: '\u26D3',
  Fingerprint: '\u2042',
  Hash: '#',
  HardDrive: '\u25A4',
  Palette: '\u25D0',
  Timer: '\u23F2',
  Network: '\u29BF',
  BookOpen: '\u2756',
  Regex: '.*',
  Lock: '\u25A3',
  ChevronDown: '\u2304',
};

/* ── tool registry ── */

export interface ToolEntry {
  id: string;
  name: string;
  desc: string;
  /** Name of the source lucide icon, resolved to a glyph via `ICON_GLYPH`. */
  icon: string;
  color: string;
}

export function useToolList(): ToolEntry[] {
  const t = useNativeTranslationFallback();
  return useMemo(
    () => [
      {id: 'vin', name: t('Vin Decoder'), desc: t('Vin Decoder Desc'), icon: 'Car', color: 'cyan'},
      {id: 'jwt', name: t('Jwt Decoder'), desc: t('Jwt Decoder Desc'), icon: 'Key', color: 'purple'},
      {id: 'timestamp', name: t('Timestamp'), desc: t('Timestamp Desc'), icon: 'Clock', color: 'green'},
      {id: 'base64', name: t('devtools.utils.base64', 'Base64'), desc: t('devtools.utils.base64Desc', 'Base64Desc'), icon: 'Braces', color: 'amber'},
      {id: 'url', name: t('Url Encoder'), desc: t('Url Encoder Desc'), icon: 'Link', color: 'cyan'},
      {id: 'json', name: t('Json Formatter'), desc: t('Json Formatter Desc'), icon: 'Braces', color: 'green'},
      {id: 'uuid', name: t('Uuid Generator'), desc: t('Uuid Generator Desc'), icon: 'Fingerprint', color: 'purple'},
      {id: 'hash', name: t('Hash Calculator'), desc: t('Hash Calculator Desc'), icon: 'Hash', color: 'red'},
      {id: 'bytes', name: t('Byte Size'), desc: t('Byte Size Desc'), icon: 'HardDrive', color: 'cyan'},
      {id: 'color', name: t('Color Converter'), desc: t('Color Converter Desc'), icon: 'Palette', color: 'purple'},
      {id: 'cron', name: t('Cron Parser'), desc: t('Cron Parser Desc'), icon: 'Timer', color: 'green'},
      {id: 'http', name: t('Http Status'), desc: t('Http Status Desc'), icon: 'Network', color: 'amber'},
      {id: 'tesla-api', name: t('Tesla Api Ref'), desc: t('Tesla Api Ref Desc'), icon: 'BookOpen', color: 'cyan'},
      {id: 'regex', name: t('Regex Tester'), desc: t('Regex Tester Desc'), icon: 'Regex', color: 'red'},
      {id: 'unix-perm', name: t('Unix Perm'), desc: t('Unix Perm Desc'), icon: 'Lock', color: 'green'},
    ],
    [t],
  );
}

/* ── tool body (native-safe stand-in for the `./tools/*` components) ── */

function ToolUnavailableBody({tool, t}: {tool: ToolEntry; t: NativeTFunction}) {
  return (
    <View style={styles.toolBody} testID={`devtools-tool-body-${tool.id}`}>
      <AppText style={styles.toolBodyTitle} weight="semibold">
        {tool.name}
      </AppText>
      <AppText style={styles.toolBodyText} tone="muted">
        {t(
          'devtools.utils.nativeUnavailable',
          'This tool’s interactive UI is provided by its own native module and is not yet available in this native build.',
        )}
      </AppText>
    </View>
  );
}

/* ── expandable tool card ── */

interface ExpandableToolCardProps {
  tool: ToolEntry;
  expanded: boolean;
  onToggle: () => void;
  t: NativeTFunction;
}

function ExpandableToolCard({tool, expanded, onToggle, t}: ExpandableToolCardProps) {
  const chip = ICON_COLOR_MAP[tool.color] ?? ICON_COLOR_MAP.cyan;
  return (
    <GlassPanel style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded}}
        onPress={onToggle}
        style={({pressed}) => [
          styles.cardHeader,
          pressed && styles.cardHeaderPressed,
        ]}
        testID={`devtools-tool-toggle-${tool.id}`}>
        <View
          style={[
            styles.iconChip,
            {backgroundColor: chip.backgroundColor, borderColor: chip.borderColor},
          ]}>
          <AppText style={[styles.iconGlyph, {color: chip.color}]}>
            {ICON_GLYPH[tool.icon] ?? ICON_GLYPH.Braces}
          </AppText>
        </View>
        <View style={styles.cardHeaderText}>
          <AppText style={styles.cardTitle} weight="semibold">
            {tool.name}
          </AppText>
          <AppText style={styles.cardDesc} tone="secondary">
            {tool.desc}
          </AppText>
        </View>
        <AppText
          style={[styles.chevron, expanded && styles.chevronExpanded]}
          tone="muted">
          {ICON_GLYPH.ChevronDown}
        </AppText>
      </Pressable>
      {expanded ? (
        <View style={styles.cardBody}>
          <ToolUnavailableBody t={t} tool={tool} />
        </View>
      ) : null}
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Client Utilities Section — searchable grid
   ═══════════════════════════════════════════════════════════════════════ */

export function ClientUtilitiesSection() {
  const t = useNativeTranslationFallback();
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tools = useToolList();

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return tools;
    }
    const q = search.toLowerCase();
    return tools.filter(
      tool =>
        tool.name.toLowerCase().includes(q) ||
        tool.desc.toLowerCase().includes(q),
    );
  }, [tools, search]);

  return (
    <View style={styles.section} testID="devtools-client-utilities">
      <View style={styles.searchRow}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder={t('devtools.searchTools', 'Search tools...')}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          testID="devtools-search-input"
          value={search}
        />
      </View>
      <View style={styles.grid}>
        {filtered.map(tool => (
          <ExpandableToolCard
            key={tool.id}
            expanded={expandedId === tool.id}
            onToggle={() =>
              setExpandedId(prev => (prev === tool.id ? null : tool.id))
            }
            t={t}
            tool={tool}
          />
        ))}
      </View>
      {filtered.length === 0 ? (
        <AppText style={styles.empty} tone="muted" testID="devtools-no-tools">
          {t('devtools.noToolsFound', 'No tools match your search')}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  searchRow: {
    maxWidth: 420,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    fontSize: typography.body,
  },
  grid: {
    gap: spacing.md,
  },
  card: {
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  cardHeaderPressed: {
    opacity: 0.85,
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  cardHeaderText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: typography.body,
  },
  cardDesc: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  chevron: {
    fontSize: 16,
  },
  chevronExpanded: {
    transform: [{rotate: '180deg'}],
  },
  cardBody: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
  },
  toolBody: {
    gap: spacing.xs,
  },
  toolBodyTitle: {
    fontSize: typography.body,
  },
  toolBodyText: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: spacing.lg,
    fontSize: typography.caption,
  },
});
