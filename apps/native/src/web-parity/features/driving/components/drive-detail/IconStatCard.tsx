// IconStatCard — native parity port of
// web/src/features/driving/components/drive-detail/IconStatCard.tsx.
//
// IconStatCard is a small centered drive-detail stat tile: a GlassPanel holding
// a coloured leading icon, a large bold value, and a tiny muted label. Callers
// (DriveStatCards) pass a lucide icon component plus a hex `color`, a `value`
// node (an AnimatedNumber element or a formatted string) and a `label` string.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - `import { GlassPanel } from '@/components/ui'` (web L1) -> the native
//     GlassPanel (../../../../../components/ui/GlassPanel, same 5-level depth as
//     the sibling cost-analysis/weekly-digest ports). AppText + theme colors
//     added for the text primitives.
//   - `import type { LucideIcon } from 'lucide-react'` (web L2): lucide-react is
//     a browser-only SVG library and must NOT be imported into native output. The
//     `icon` prop keeps the SAME contract a lucide icon satisfies — a component
//     accepting `color` (and `size`) — typed as
//     `ComponentType<{ color?: string; size?: number }>`. IconStatCard still owns
//     the colour injection (web `style={{ color }}`), so call sites stay
//     `<IconStatCard icon={SomeIcon} color="#..." .../>` once DriveStatCards is
//     converted to pass a native glyph/icon component.
//   - IconStatCardProps (web L4-9) reproduced field-for-field; `value` stays a
//     `React.ReactNode` rendered inside the value AppText exactly like the web
//     `<p>{value}</p>` (RN Text accepts strings + nested Text children).
//   - `GlassPanel className="p-4 text-center"` (web L13) -> styles.panel padding
//     16 (p-4) + alignItems center (text-center centers the column's children).
//   - icon `h-4 w-4 mx-auto mb-1` (web L14) -> size 16 (h-4 w-4), centered by the
//     panel's alignItems (mx-auto), wrapped in a View with marginBottom 4 (mb-1);
//     `style={{ color }}` -> the dynamic `color` forwarded as the Icon `color` prop.
//   - value `text-lg font-bold text-[var(--text-primary)]` (web L15) -> fontSize
//     18 / lineHeight 28 (text-lg), fontWeight 700 (font-bold, kept literal so it
//     matches Tailwind 700 rather than AppText bold=800 — the HighlightCard
//     precedent), colors.textPrimary (--text-primary), textAlign center.
//   - label `text-[10px] text-[var(--text-muted)]` (web L16) -> fontSize 10 /
//     lineHeight 14, tone="muted" (--text-muted), textAlign center.
// No DOM / lucide-react / Recharts / Leaflet / old web-UI imports — RN primitives
// only. See the .parity.json sidecar for the line-by-line source map.

import React, {type ComponentType, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

// ---- Props (web IconStatCardProps L4-9) -------------------------------------
// `icon: LucideIcon` (L5) -> a native component accepting `color`/`size` (the
// renderable contract a lucide icon satisfies); `color` (L6), `value` (L7) and
// `label` (L8) reproduced verbatim so the DriveStatCards call sites stay
// structurally identical.

interface IconStatCardProps {
  icon: ComponentType<{color?: string; size?: number}>;
  color: string;
  value: ReactNode;
  label: string;
}

const ICON_SIZE = 16; // web `h-4 w-4`

export function IconStatCard({
  icon: Icon,
  color,
  value,
  label,
}: IconStatCardProps): React.ReactElement {
  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.iconWrap}>
        <Icon color={color} size={ICON_SIZE} />
      </View>
      <AppText style={styles.value}>{value}</AppText>
      <AppText style={styles.label} tone="muted">
        {label}
      </AppText>
    </GlassPanel>
  );
}

IconStatCard.displayName = 'IconStatCard';

const styles = StyleSheet.create({
  // web `p-4 text-center` (L13): padding 16 + center the column's children.
  panel: {
    padding: 16,
    alignItems: 'center',
  },
  // web icon `mx-auto mb-1` (L14): centered by the panel, 4px bottom gap.
  iconWrap: {
    marginBottom: 4,
  },
  // web value `text-lg font-bold text-[var(--text-primary)]` (L15).
  value: {
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  // web label `text-[10px] text-[var(--text-muted)]` (L16).
  label: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
});
