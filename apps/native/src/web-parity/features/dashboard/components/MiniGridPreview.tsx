// Native parity port of web/src/features/dashboard/components/MiniGridPreview.tsx.
//
// The web source renders a tiny non-interactive "mini map" of a saved dashboard's
// `lg` grid layout: an `aspect-ratio: cols / safeMaxY` container with one absolutely
// positioned tile per layout item, each tile sized/placed by percentage from the
// react-grid-layout coordinates. The only inner content is a decorative 12px muted
// widget icon, resolved from the widget registry via `getWidgetDef(widget.widgetId)`.
//
// None of the web source's imports are native-safe:
//   * `@/lib/cn` (clsx + tailwind-merge) + the Tailwind/CSS-var className strings and
//     the DOM `<div>` are browser-only — reproduced with React Native `View` +
//     `StyleSheet`. The web `aspect-ratio: "${cols} / ${safeMaxY}"` CSS string maps to
//     RN's numeric `aspectRatio = cols / safeMaxY` (same width/height ratio), and the
//     per-tile percent `left/top/width/height` are kept verbatim as `DimensionValue`
//     percentage strings.
//   * `GRID_COLS` from `../hooks/useDashboardLayout` pulls in the full react-grid-layout
//     dashboard hook (browser-only); its single consumed value `GRID_COLS.lg === 4` is
//     inlined as `GRID_COLS_LG`, matching the sibling ExportModal port.
//   * `getWidgetDef` from `../widgets/registry` returns lucide-react icon components and
//     lazy-loaded web widget modules — both browser-only, and no native widget registry
//     exists in this file-by-file loop. So the per-tile decorative icon (web L31-33, L47)
//     is the file's one piece of unavailable browser behavior: it is rendered as an
//     explicit no-icon empty state (the tile block — the dominant visual — is preserved,
//     centered+padded exactly like the web tile so an icon could later drop in). This
//     mirrors how the reviewed ExportModal port handles the same inlined preview.
//   * `../widgets/types` has no native port yet, so the `SavedDashboard` shape this
//     component consumes is mirrored locally, field-for-field with the web source.
//
// The web `className` extension prop becomes the native idiom `style`, composed after
// the base style (so callers can override, like tailwind-merge) while the computed
// `aspectRatio` stays authoritative last (matching the web inline `style` winning over
// className). The web hover `transition-colors` has no native analog and is omitted.
//
// No DOM, no `@/lib/cn`, no lucide-react, no Recharts/Leaflet, and no web UI components
// are imported.

import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// --- Local mirrors of `../widgets/types` -----------------------------------
// The native `../widgets/types` port does not exist yet in this file-by-file
// loop, so the `SavedDashboard` shape `MiniGridPreview` consumes is reproduced
// here field-for-field to keep the port self-contained and typed.
interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  moved?: boolean;
}

interface RGLLayouts {
  [breakpoint: string]: RGLLayout[];
}

interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  vehicleId?: number | null;
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

// web `GRID_COLS.lg` (4) from `../hooks/useDashboardLayout`.
const GRID_COLS_LG = 4;

interface MiniGridPreviewProps {
  dashboard: SavedDashboard;
  // Native analog of the web `className` extension prop.
  style?: StyleProp<ViewStyle>;
}

export function MiniGridPreview({dashboard, style}: MiniGridPreviewProps) {
  const lgLayout = dashboard.layouts.lg ?? [];
  const cols = GRID_COLS_LG; // 4

  const maxY =
    lgLayout.length > 0 ? Math.max(...lgLayout.map(l => l.y + l.h)) : 2;

  // Guard against zero/NaN maxY.
  const safeMaxY = maxY > 0 && Number.isFinite(maxY) ? maxY : 2;

  return (
    <View style={[styles.preview, style, {aspectRatio: cols / safeMaxY}]}>
      {lgLayout.map(item => (
        // The web tile centers a decorative widget icon resolved from the
        // browser-only widget registry; no native registry exists, so the tile
        // renders without inner content (explicit no-icon state).
        <View
          key={item.i}
          style={[
            styles.previewTile,
            {
              left: `${(item.x / cols) * 100}%` as DimensionValue,
              top: `${(item.y / safeMaxY) * 100}%` as DimensionValue,
              width: `${(item.w / cols) * 100}%` as DimensionValue,
              height: `${(item.h / safeMaxY) * 100}%` as DimensionValue,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // web: relative w-full bg-white/[0.02] rounded-lg border border-white/[0.06]
  // overflow-hidden.
  preview: {
    width: '100%',
    position: 'relative',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  // web: absolute rounded-sm bg-white/[0.06] border border-white/[0.08]
  // flex items-center justify-center + padding 2px (transition-colors dropped).
  previewTile: {
    position: 'absolute',
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
});
