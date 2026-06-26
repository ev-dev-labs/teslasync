// Native parity port of web/src/features/admin/components/devtools/ToolCard.tsx.
//
// The web module is a tiny presentational shell for the Fleet API dev-tools: a
// GlassPanel whose header shows a colour-tinted icon box (driven by the `color`
// prop, not the icon's own meaning) next to a title + description, with the
// tool's interactive body rendered below as `children`.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • The web `GlassPanel className="p-5"` -> the shared native GlassPanel with
//     a padded style (spacing.lg === Tailwind p-5 === 20px).
//   • `cn(...)` class merging is DOM/Tailwind-only -> replaced by RN style
//     arrays, so the helper is intentionally dropped.
//   • `ICON_COLOR_MAP` (Tailwind neon classes) lives in the not-yet-ported
//     ./constants sibling, so — following the FleetApiSection precedent that
//     inlines the same map — it is inlined here as TOOL_COLOR_STYLES (tinted
//     box tokens), keyed by the same colour names with the same `?? cyan`
//     fallback for unknown colours.
//   • `icon: React.ElementType` (a lucide component rendered via className)
//     -> `icon: SemanticIconName`; the glyph is drawn inside the colour box so
//     the box + glyph colour still come from the `color` prop, matching the web.
//   • Raw DOM <div>/<h3>/<p> -> RN <View>/<AppText>; the title/description tone
//     and sizing mirror the web text-sm/text-xs + secondary colour.
// No DOM elements, lucide-react, Recharts, Leaflet, or web UI kit modules are
// imported into the native output.

import React, {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── inlined ./constants ICON_COLOR_MAP ──────────────────────────────── */

interface ToolColorStyle {
  bg: string;
  border: string;
  fg: string;
}

// web ICON_COLOR_MAP (Tailwind neon classes) -> native tinted box tokens.
const TOOL_COLOR_STYLES: Record<string, ToolColorStyle> = {
  cyan: {bg: colors.accentSoft, border: colors.borderAccent, fg: colors.accent},
  green: {bg: colors.successSurface, border: colors.successBorder, fg: colors.success},
  purple: {bg: colors.violetSurface, border: colors.violetBorder, fg: colors.violet},
  amber: {bg: colors.warningSurface, border: colors.warningBorder, fg: colors.warning},
  red: {bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger},
};

interface ToolCardProps {
  icon: SemanticIconName;
  color: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function ToolCard({icon, color, title, description, children}: ToolCardProps) {
  const tint = TOOL_COLOR_STYLES[color] ?? TOOL_COLOR_STYLES.cyan;

  return (
    <GlassPanel style={styles.toolCard}>
      <View style={styles.toolHeader}>
        <View style={[styles.toolIcon, {backgroundColor: tint.bg, borderColor: tint.border}]}>
          <AppText style={[styles.toolIconGlyph, {color: tint.fg}]} weight="bold">
            {getSemanticIconDefinition(icon).glyph}
          </AppText>
        </View>
        <View style={styles.toolHeaderText}>
          <AppText style={styles.toolTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.toolDesc} tone="secondary" variant="caption">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  toolCard: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  toolHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  toolIcon: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  toolIconGlyph: {
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 18,
  },
  toolHeaderText: {
    flex: 1,
  },
  toolTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  toolDesc: {
    color: colors.textSecondary,
    marginTop: 2,
  },
});
