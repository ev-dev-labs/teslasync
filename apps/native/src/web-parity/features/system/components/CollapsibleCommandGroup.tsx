// Native parity port of
// web/src/features/system/components/CollapsibleCommandGroup.tsx.
//
// Renders one collapsible category group on the Vehicle Commands page: a
// full-width ghost toggle row (category icon + uppercase label + "(count)" + a
// chevron that flips when open) above a responsive grid of command tiles
// (`children`) that is mounted only while the group is expanded. The open state
// persists per vehicle+category for the lifetime of the session.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • Browser `sessionStorage` -> an in-process module-level `sessionStore`
//     (Map). RN ships no sessionStorage and no AsyncStorage is wired into the
//     parity bundle; an in-memory store preserves the source's SYNCHRONOUS
//     lazy-init read + write-on-toggle and the per-session lifetime (state is
//     dropped when the JS runtime/app session ends), keyed by the identical
//     `teslasync-cat-${vehicleId}-${category}` key. The try/catch guards are
//     kept verbatim to preserve the source's resilience structure.
//   • The not-yet-ported `../commands` sibling (a ~900-line command catalog with
//     its own conversion slot) is NOT imported; only the two symbols this file
//     needs are inlined — the `CommandCategory` union and a minimal
//     `CATEGORY_META` whose lucide `icon` is remapped to the parity
//     `SemanticIconName` system (ToolCard / FleetApiSection inlining precedent).
//   • react-i18next `useTranslation()` -> a local `useTranslation()` whose
//     `t(key, fallback)` returns the English fallback, preserving every key +
//     default copy at the call site (NotificationGroupRow precedent).
//   • The shared web `<Button variant="ghost">` composite -> a RN `Pressable`
//     row (the web Button hosts icon+label+count+chevron children, which the
//     native AppButton's label-only API cannot); `aria-expanded` ->
//     `accessibilityState={{expanded}}`.
//   • lucide `<ChevronDown>` + Tailwind `rotate-180` -> a '⌄' text glyph with a
//     `rotate: 180deg` transform when open (same flip intent). The leading
//     category icon (web inline 16px muted line icon) -> the parity icon's muted
//     text glyph (inline-glyph precedent). `cn()` + Tailwind classes ->
//     StyleSheet + theme tokens. The web responsive CSS grid (2/3/4 columns) ->
//     a flex-wrap row (RN has no CSS grid; column count is realised by the
//     child tiles' own flexBasis — the standard parity precedent).
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, or web
// UI-kit modules are imported into the native output.

import React, {useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {FadeIn} from '../../../components/motion/FadeIn';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next: the parity bundle ships no i18n runtime,
// so `t` returns the English fallback (or the key) while preserving every key +
// default copy at the call site.
function useTranslation(): {t: TFunc} {
  return {t: (key, fallback) => fallback ?? key};
}

/* ─── session persistence (web sessionStorage) ────────────────────────── */

// In-process replacement for the browser `sessionStorage` the source uses to
// remember each group's open state. Module-level so it survives re-mounts, and
// synchronous so the useState lazy initializer below keeps the source's exact
// shape; like sessionStorage it is cleared when the app/runtime session ends.
const sessionMemory = new Map<string, string>();

const sessionStore = {
  getItem(key: string): string | null {
    return sessionMemory.has(key) ? (sessionMemory.get(key) as string) : null;
  },
  setItem(key: string, value: string): void {
    sessionMemory.set(key, value);
  },
};

/* ─── inlined `../commands` category metadata ─────────────────────────── */

// Mirrors the source `CommandCategory` union + `CATEGORY_META` map; each
// category's lucide icon is remapped to the parity SemanticIconName system
// (security->security, wind->wind, securityAlert->securityAlert, charging,
// doorOpen, vehicle, arrowUpFromDot, calendarPlus, speaker, navigation,
// download, play).
export type CommandCategory =
  | 'security'
  | 'climate'
  | 'climate_protection'
  | 'charging'
  | 'doors'
  | 'drive'
  | 'windows'
  | 'sunroof'
  | 'schedules'
  | 'alerts'
  | 'navigation'
  | 'software'
  | 'vehicle'
  | 'media';

interface CategoryMeta {
  labelKey: string;
  fallback: string;
  icon: SemanticIconName;
}

const CATEGORY_META: Record<CommandCategory, CategoryMeta> = {
  security: {
    labelKey: 'commands.cat.security',
    fallback: 'Security & Access',
    icon: 'security',
  },
  climate: {
    labelKey: 'commands.cat.climate',
    fallback: 'Climate & Comfort',
    icon: 'wind',
  },
  climate_protection: {
    labelKey: 'commands.cat.climateProtect',
    fallback: 'Climate Protection',
    icon: 'securityAlert',
  },
  charging: {
    labelKey: 'commands.cat.charging',
    fallback: 'Charging',
    icon: 'charging',
  },
  doors: {
    labelKey: 'commands.cat.doors',
    fallback: 'Doors & Trunk',
    icon: 'doorOpen',
  },
  drive: {
    labelKey: 'commands.cat.drive',
    fallback: 'Drive',
    icon: 'vehicle',
  },
  windows: {
    labelKey: 'commands.cat.windows',
    fallback: 'Windows',
    icon: 'wind',
  },
  sunroof: {
    labelKey: 'commands.cat.sunroof',
    fallback: 'Sunroof',
    icon: 'arrowUpFromDot',
  },
  schedules: {
    labelKey: 'commands.cat.schedules',
    fallback: 'Schedules',
    icon: 'calendarPlus',
  },
  alerts: {
    labelKey: 'commands.cat.alerts',
    fallback: 'Alerts & Location',
    icon: 'speaker',
  },
  navigation: {
    labelKey: 'commands.cat.navigation',
    fallback: 'Navigation',
    icon: 'navigation',
  },
  software: {
    labelKey: 'commands.cat.software',
    fallback: 'Software',
    icon: 'download',
  },
  vehicle: {
    labelKey: 'commands.cat.vehicle',
    fallback: 'Vehicle',
    icon: 'vehicle',
  },
  media: {
    labelKey: 'commands.cat.media',
    fallback: 'Media',
    icon: 'play',
  },
};

/* ─── component ───────────────────────────────────────────────────────── */

interface CollapsibleCommandGroupProps {
  category: CommandCategory;
  vehicleId: number;
  children: ReactNode;
  count: number;
  defaultOpen?: boolean;
}

export function CollapsibleCommandGroup({
  category,
  vehicleId,
  children,
  count,
  defaultOpen = false,
}: CollapsibleCommandGroupProps) {
  const {t} = useTranslation();
  const storageKey = `teslasync-cat-${vehicleId}-${category}`;

  const [open, setOpen] = useState(() => {
    try {
      const stored = sessionStore.getItem(storageKey);
      return stored !== null ? stored === 'true' : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      sessionStore.setItem(storageKey, String(next));
    } catch {
      /* noop */
    }
  };

  const meta = CATEGORY_META[category];
  const icon = getSemanticIconDefinition(meta.icon);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={toggle}
        style={({pressed}) => [styles.toggle, pressed && styles.togglePressed]}>
        <AppText style={styles.icon}>{icon.glyph}</AppText>
        <AppText style={styles.label}>{t(meta.labelKey, meta.fallback)}</AppText>
        <AppText style={styles.count}>({count})</AppText>
        <AppText style={[styles.chevron, open && styles.chevronOpen]}>⌄</AppText>
      </Pressable>
      {open && (
        <FadeIn>
          <View style={styles.grid}>{children}</View>
        </FadeIn>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  togglePressed: {
    opacity: 0.7,
  },
  icon: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  count: {
    fontSize: 10,
    lineHeight: 16,
    marginLeft: spacing.xs,
    color: colors.textMuted,
  },
  chevron: {
    marginLeft: 'auto',
    fontSize: 14,
    lineHeight: 16,
    color: colors.textMuted,
  },
  chevronOpen: {
    transform: [{rotate: '180deg'}],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
