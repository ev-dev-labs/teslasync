// InfoTile — native parity port of
// web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx.
//
// InfoTile is a compact telemetry stat tile: a GlassPanel holding a small muted
// header row (a leading icon + a truncated label) above a large semibold value,
// with an optional tiny muted sub line. Callers (TelemetryGrid) pass a lucide
// icon component, a label, a string|number|boolean value, an optional Tailwind
// text-colour class for the value, and an optional sub string.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - `import { cn } from '@/lib/cn'` (web L1): the clsx/tailwind-merge class
//     helper has no React Native analog. The only dynamic class it merged was
//     the `color` prop, so cn is dropped and `color` (a Tailwind text-colour
//     class string) is resolved to a native colour via `resolveValueColor`.
//   - `import { GlassPanel } from '@/components/ui'` (web L2) -> the native
//     GlassPanel (../../../../../components/ui/GlassPanel, the IconStatCard /
//     HighlightCard 5-level-depth precedent). AppText + theme colors added for
//     the text primitives.
//   - `icon: React.ElementType` (web L5): React.ElementType lets the web render
//     a lucide-react SVG component via `className`. lucide-react is browser-only
//     and forbidden in native output (rule 4), so the icon prop keeps the same
//     renderable contract a lucide icon satisfies — `ComponentType<{ color?;
//     size? }>` (the IconStatCard precedent). The icon inherits the header's
//     `text-[var(--text-muted)]` colour (web L22 currentColor) at size 14
//     (h-3.5 w-3.5).
//   - `value: string | number | boolean` (web L7) + the boolean -> 'Yes'/'No'
//     mapping (web L19) reproduced verbatim; 'Yes'/'No' are hardcoded English in
//     the source (no i18n call), so they are preserved as-is.
//   - `color?: string` default `'text-[var(--text-primary)]'` (web L8/L16)
//     preserved verbatim as the prop + default; resolved to a native colour at
//     render time.
//   - `title={String(display)}` (web L26) is a DOM hover tooltip showing the
//     full value when truncated; touch RN has no hover/title analog, so it is
//     dropped (the value already renders; truncation uses numberOfLines).
//   - Tailwind layout -> StyleSheet: p-4 -> padding 16; overflow-hidden ->
//     overflow 'hidden'; the header `flex items-center gap-2 text-xs mb-1.5
//     min-w-0` -> row (flexDirection row, alignItems center, gap 8, marginBottom
//     6) with a shrinkable truncating label; truncate -> numberOfLines 1;
//     text-lg font-semibold -> fontSize 18 / weight 600; text-[10px] mt-0.5 ->
//     fontSize 10 / marginTop 2; --text-muted -> tone muted.
// No DOM / cn / lucide-react / Recharts / Leaflet / old web-UI imports — RN
// primitives only. See the .parity.json sidecar for the line-by-line map.

import React, {type ComponentType} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

// web InfoTileProps (L4-10). `icon: React.ElementType` -> the native renderable
// contract a lucide icon satisfies; `value` keeps the string|number|boolean
// union; `color` stays the Tailwind text-colour class string (resolved below).
interface InfoTileProps {
  icon: ComponentType<{color?: string; size?: number}>;
  label: string;
  value: string | number | boolean;
  color?: string;
  sub?: string;
}

const ICON_SIZE = 14; // web `h-3.5 w-3.5`

// Resolve the web `color` Tailwind text-colour class to a native colour. Covers
// the values TelemetryGrid passes (emerald/amber/rose-300 + the --text-primary/
// --text-muted CSS vars) plus the documented toned-down -300 palette; unknown
// classes fall back to the primary text colour (the web default).
const VALUE_COLORS: Record<string, string> = {
  'text-[var(--text-primary)]': colors.textPrimary,
  'text-[var(--text-secondary)]': colors.textSecondary,
  'text-[var(--text-muted)]': colors.textMuted,
  'text-emerald-300': '#6ee7b7',
  'text-amber-300': '#fcd34d',
  'text-rose-300': '#fda4af',
  'text-cyan-300': '#67e8f9',
  'text-indigo-300': '#a5b4fc',
  'text-purple-300': '#d8b4fe',
  'text-pink-300': '#f9a8d4',
};

function resolveValueColor(colorClass: string): string {
  return VALUE_COLORS[colorClass] ?? colors.textPrimary;
}

export function InfoTile({
  icon: Icon,
  label,
  value,
  color = 'text-[var(--text-primary)]',
  sub,
}: InfoTileProps): React.ReactElement {
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value;
  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.header}>
        <Icon color={colors.textMuted} size={ICON_SIZE} />
        <AppText style={styles.label} tone="muted" numberOfLines={1}>
          {label}
        </AppText>
      </View>
      <AppText
        style={[styles.value, {color: resolveValueColor(color)}]}
        numberOfLines={1}>
        {display}
      </AppText>
      {sub ? (
        <AppText style={styles.sub} tone="muted">
          {sub}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

InfoTile.displayName = 'InfoTile';

const styles = StyleSheet.create({
  // web `p-4 overflow-hidden` (L21).
  panel: {
    padding: 16,
    overflow: 'hidden',
  },
  // web header `flex items-center gap-2 text-xs mb-1.5 min-w-0` (L22).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  // web label `<span className="truncate">` under text-xs + --text-muted (L24).
  label: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  // web value `text-lg font-semibold truncate` (L26); colour applied inline.
  value: {
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '600',
  },
  // web sub `text-[10px] text-[var(--text-muted)] mt-0.5` (L29).
  sub: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
});
