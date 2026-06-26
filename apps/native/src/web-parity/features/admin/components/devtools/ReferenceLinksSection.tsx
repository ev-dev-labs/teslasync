// Native parity port of
// web/src/features/admin/components/devtools/ReferenceLinksSection.tsx.
//
// The web source renders a responsive grid (`grid gap-4 sm:grid-cols-2
// lg:grid-cols-4`) of Tesla Fleet API reference cards. Each card is a hoverable
// `GlassPanel` wrapping an `<a target="_blank" rel="noopener noreferrer">` that
// lays out a cyan-tinted rounded icon box (the web `ICON_COLOR_MAP.cyan` tile
// holding a lucide glyph picked from `ICON_MAP[link.icon] ?? BookOpen`), the
// i18n link title (`t(link.title)`), and the raw URL. Its data and the colour /
// icon maps come from the sibling `./constants` module.
//
// This port keeps that exact behaviour with React Native primitives and the
// existing native tokens / design-system pieces:
//   * The `./constants` module has no native port yet, so — mirroring how the
//     sibling BackendTool inlines the dev-tools pieces it needs — REFERENCE_LINKS
//     and the icon map are inlined here verbatim (same titles, urls, and icon
//     keys; same `?? BookOpen` default).
//   * lucide-react `BookOpen / Globe / ExternalLink / Radio` have no native
//     analogue (the app ships no SVG/vector icon set), so `ICON_MAP` maps the
//     four web icon-string keys to the repo's `SemanticIcon` glyph vocabulary,
//     the established way every native parity port renders a lucide glyph
//     (DraftRecoveryBanner, ChartExportMenu, ...). BookOpen has no book glyph,
//     so it maps to the closest documentation intent, `fileText`, which is also
//     the default fallback (web `?? BookOpen`).
//   * The web `ICON_COLOR_MAP.cyan` tile (`bg-neon-cyan/10 text-neon-cyan ring-1
//     ring-neon-cyan/20`) becomes a cyan tinted box built from the accent token
//     stops (the same ICON_COLOR_MAP -> tinted-box mapping the sibling
//     BackendTool's ICON_TINTS uses), holding the SemanticIcon glyph in cyan so
//     the uniform-cyan visual intent is preserved across all four cards.
//   * The hoverable web `<a>` becomes a `Pressable` (accessibilityRole="link")
//     that opens the URL through React Native `Linking.openURL` — the native
//     analogue of `target="_blank"`; like the web `<a>` it silently no-ops when
//     the platform cannot open the target.
//   * `cn` / Tailwind classes are dropped in favour of an RN StyleSheet, and the
//     `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` becomes a flex-wrap row whose
//     cards grow from a min basis (1 column on phones, more as width allows).
//
// react-i18next is replaced by the self-contained fallback used across the
// native parity tree: `t(link.title)` returns the key when no fallback is given,
// matching the web exactly (these `devtools.ref.*` keys are absent from
// en.json, so i18next returns the key and the web renders it literally too). No
// DOM, no lucide-react, no Recharts/Leaflet, and no web UI components imported.

import { useCallback } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { colors } from '../../../../../theme/tokens';

type NativeTFunction = (key: string, fallback?: string) => string;

// Native parity has no i18n runtime wired, so this returns the supplied fallback
// or the key itself. The web calls `t(link.title)` with no fallback and the
// `devtools.ref.*` keys are not in en.json, so i18next returns the key — this
// hook reproduces that behaviour exactly when called the same way.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

interface ReferenceLink {
  title: string;
  url: string;
  icon: string;
}

// Native analogue of the web `./constants` REFERENCE_LINKS — identical titles
// (i18n keys), urls, and icon keys.
const REFERENCE_LINKS: ReferenceLink[] = [
  {
    title: 'devtools.ref.fleetOverview',
    url: 'https://developer.tesla.com/docs/fleet-api',
    icon: 'BookOpen',
  },
  {
    title: 'devtools.ref.partnerEndpoints',
    url: 'https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register',
    icon: 'Globe',
  },
  {
    title: 'devtools.ref.devPortal',
    url: 'https://developer.tesla.com',
    icon: 'ExternalLink',
  },
  {
    title: 'devtools.ref.telemetryGuide',
    url: 'https://developer.tesla.com/docs/fleet-api/fleet-telemetry',
    icon: 'Radio',
  },
];

// Native analogue of the web `./constants` ICON_MAP. The web maps the four icon
// keys to lucide components; native maps them to the repo's SemanticIcon glyph
// names. BookOpen has no book glyph in the SemanticIcon set, so it maps to the
// closest documentation intent, `fileText` (also the `?? BookOpen` default).
const ICON_MAP: Record<string, SemanticIconName> = {
  BookOpen: 'fileText',
  Globe: 'globe',
  ExternalLink: 'externalLink',
  Radio: 'radio',
};

// Native analogue of the web `ICON_COLOR_MAP.cyan` tile
// (`bg-neon-cyan/10 text-neon-cyan ring-1 ring-neon-cyan/20`): the soft accent
// surface fill, the hairline accent ring, and the accent glyph colour.
const CYAN_TINT = {
  surface: colors.accentSoft,
  border: colors.borderAccent,
  glyph: colors.accent,
} as const;

// The native analogue of `target="_blank"`. Like the web `<a>` it silently
// no-ops when the platform cannot open the URL (the web card surfaces no error).
function openReferenceLink(url: string): void {
  void Linking.openURL(url).catch(() => {
    // Intentionally ignored: matches the web <a> which shows no link error.
  });
}

export function ReferenceLinksSection() {
  const t = useNativeTranslationFallback();

  return (
    <View style={styles.grid}>
      {REFERENCE_LINKS.map((link) => {
        const iconName = ICON_MAP[link.icon] ?? ICON_MAP.BookOpen;
        const glyph = getSemanticIconDefinition(iconName).glyph;
        const title = t(link.title);

        return (
          <GlassPanel key={link.url} style={styles.card}>
            <Pressable
              accessibilityHint={link.url}
              accessibilityLabel={title}
              accessibilityRole="link"
              onPress={() => openReferenceLink(link.url)}
              style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
            >
              <View style={styles.iconBox}>
                <AppText style={styles.iconGlyph}>{glyph}</AppText>
              </View>
              <View style={styles.body}>
                <AppText numberOfLines={1} style={styles.title} weight="semibold">
                  {title}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={styles.url}
                  tone="muted"
                  variant="caption"
                >
                  {link.url}
                </AppText>
              </View>
            </Pressable>
          </GlassPanel>
        );
      })}
    </View>
  );
}

ReferenceLinksSection.displayName = 'ReferenceLinksSection';

const styles = StyleSheet.create({
  // web `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`: a flex-wrap row whose cards
  // grow from a min basis (1 column on phones, 2+ as the viewport widens).
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  // web `GlassPanel hover p-4` — padding p-4 (16) on the shared glass surface.
  card: {
    flexBasis: 240,
    flexGrow: 1,
    minWidth: 240,
    padding: 16,
  },
  // web `<a> flex items-start gap-3` — the pressable link row.
  link: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  // web hover affordance maps to the native pressed state.
  linkPressed: {
    opacity: 0.7,
  },
  // web `h-9 w-9 shrink-0 items-center justify-center rounded-lg` cyan tile.
  iconBox: {
    alignItems: 'center',
    backgroundColor: CYAN_TINT.surface,
    borderColor: CYAN_TINT.border,
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  // web `<Icon className="h-4 w-4" />` — the SemanticIcon glyph in accent cyan.
  iconGlyph: {
    color: CYAN_TINT.glyph,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  // web `min-w-0` body column.
  body: {
    flex: 1,
    flexShrink: 1,
  },
  // web `text-sm font-medium text-white`.
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  // web `mt-0.5 truncate text-xs text-[var(--text-muted)]`.
  url: {
    marginTop: 2,
  },
});
