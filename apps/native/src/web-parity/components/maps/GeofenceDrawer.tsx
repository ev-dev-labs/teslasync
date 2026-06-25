// Native parity port of web/src/components/maps/GeofenceDrawer.tsx.
//
// The web original mounts `leaflet-draw` editing controls onto a Leaflet
// <MapContainer> (via useMap) and renders null — its whole job is the
// pointer-driven create/edit/delete drawing toolbar. React Native has no
// Leaflet map, no DOM, and no leaflet-draw toolbar, so that interactive
// surface is genuinely unavailable here.
//
// This port keeps the exact public types and the describeFence() helper
// verbatim, and renders the supplied fences as a read-only, screen-reader
// friendly native summary with an explicit notice that interactive geofence
// drawing requires the browser map. The source's shape-detection logic
// (layerToGeometry / inferLayerType / fenceToLayer) is reproduced against the
// DrawableGeofence data model as fenceShape(), since there are no Leaflet
// layers to inspect natively.

import React, {useCallback, useMemo} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SectionHeader} from '../../../components/data/SectionHeader';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {AppText} from '../../../components/ui/AppText';
import {PremiumCard} from '../../../components/ui/PremiumCard';
import {StatusPill} from '../../../components/ui/StatusPill';
import {colors, spacing} from '../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Modes the drawer offers in its toolbar. */
export type GeofenceMode = 'circle' | 'polygon' | 'rectangle';

/** A drawn or persisted geofence — currently only circles are persisted. */
export interface DrawableGeofence {
  id: string | number;
  /** For circles. */
  lat?: number;
  lng?: number;
  /** Radius in meters (circles). */
  radius?: number;
  /** For polygons / rectangles. Ring of [lat, lng] tuples. */
  polygon?: Array<[number, number]>;
  name?: string;
}

/** New geometry produced by the drawer (no id yet). */
export interface NewGeofence {
  shape: 'circle' | 'polygon' | 'rectangle';
  lat?: number;
  lng?: number;
  radius?: number;
  polygon?: Array<[number, number]>;
}

export interface GeofenceDrawerProps {
  /** Existing geofences to render as editable shapes. */
  fences: DrawableGeofence[];
  /** Called when user finishes drawing a new shape. */
  onCreate: (g: NewGeofence) => void;
  /** Called when user edits an existing shape. */
  onEdit?: (id: string | number, g: NewGeofence) => void;
  /** Called when user deletes a shape via the on-map trash icon. */
  onDelete?: (id: string | number) => void;
  /** Restrict which shapes the user can draw. Default: ['circle']. */
  modes?: GeofenceMode[];
  /** Stroke / fill color for drawn shapes. Default '#22d3ee'. */
  color?: string;
  /** Native-only: optional container style (web had no style prop). */
  style?: StyleProp<ViewStyle>;
}

/* ------------------------------------------------------------------ */
/*  Native i18n fallback (mirrors sibling web-parity ports)            */
/* ------------------------------------------------------------------ */

type NativeTFunction = (
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => string;

function interpolate(
  fallback: string,
  params?: Record<string, string | number>,
): string {
  if (!params) {
    return fallback;
  }

  return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = params[key];
    return value == null ? match : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (
      _key: string,
      fallback: string,
      params?: Record<string, string | number>,
    ) => interpolate(fallback, params),
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_MODES: GeofenceMode[] = ['circle'];
const DEFAULT_COLOR = '#22d3ee';

const MODE_LABELS: Record<GeofenceMode, {key: string; fallback: string}> = {
  circle: {key: 'geofenceDrawer.mode.circle', fallback: 'Circle'},
  polygon: {key: 'geofenceDrawer.mode.polygon', fallback: 'Polygon'},
  rectangle: {key: 'geofenceDrawer.mode.rectangle', fallback: 'Rectangle'},
};

const SHAPE_LABELS: Record<FenceShape, {key: string; fallback: string}> = {
  circle: {key: 'geofenceDrawer.shape.circle', fallback: 'Circle'},
  polygon: {key: 'geofenceDrawer.shape.polygon', fallback: 'Polygon'},
  invalid: {key: 'geofenceDrawer.shape.invalid', fallback: 'Unsupported'},
};

interface FenceListItem {
  key: string;
  name: string;
  shape: FenceShape;
  description: string;
}

/**
 * Native-safe stand-in for the leaflet-draw GeofenceDrawer. Renders the saved
 * geofences as a read-only summary and an explicit unavailable-interaction
 * notice. The same props are accepted; the create/edit/delete callbacks cannot
 * be triggered without the browser map, so they are surfaced as the configured
 * (but unavailable) actions instead — mirroring the source's edit/remove
 * capability gating (`edit: onEdit ? … : false`, `remove: !!onDelete`).
 */
export function GeofenceDrawer({
  fences,
  onCreate,
  onEdit,
  onDelete,
  modes = DEFAULT_MODES,
  color = DEFAULT_COLOR,
  style,
}: GeofenceDrawerProps) {
  const t = useNativeTranslationFallback();

  const actions = useMemo(
    () => buildActionLabels({onCreate, onEdit, onDelete}, t),
    [onCreate, onEdit, onDelete, t],
  );

  const fenceItems = useMemo<FenceListItem[]>(
    () =>
      (fences ?? []).map((fence, index) => ({
        key: `${fence.id}-${index}`,
        name: fence.name ?? t('geofenceDrawer.unnamed', 'Geofence'),
        shape: fenceShape(fence),
        description: describeFence(fence),
      })),
    [fences, t],
  );

  return (
    <PremiumCard tone="warning" style={style} testID="geofence-drawer">
      <SectionHeader
        icon="fence"
        eyebrow={t('geofenceDrawer.eyebrow', 'Geofence editor')}
        title={t('geofenceDrawer.title', 'Geofences')}
        subtitle={t(
          'geofenceDrawer.subtitle',
          'Read-only native summary of saved geofences.',
        )}
        trailing={
          <StatusPill
            label={t('geofenceDrawer.status', 'Drawing unavailable')}
            state="warning"
          />
        }
      />

      <View
        accessibilityRole="alert"
        style={styles.notice}
        testID="geofence-drawer-native-unavailable-notice">
        <AppText variant="caption" weight="semibold" style={styles.noticeTitle}>
          {t(
            'geofenceDrawer.noticeTitle',
            'Interactive drawing requires the browser map',
          )}
        </AppText>
        <AppText variant="caption" tone="secondary">
          {t(
            'geofenceDrawer.noticeBody',
            'Creating, editing, and deleting geofences uses the Leaflet drawing toolbar, which is unavailable in the native app. Existing geofences are listed below.',
          )}
        </AppText>
      </View>

      <View style={styles.chipRow}>
        <AppText variant="caption" tone="muted">
          {t('geofenceDrawer.modesLabel', 'Draw modes')}
        </AppText>
        <View style={styles.chips}>
          {modes.map((mode, index) => (
            <View
              key={`${mode}-${index}`}
              style={[styles.modeChip, {borderColor: color}]}>
              <View style={[styles.swatch, {backgroundColor: color}]} />
              <AppText variant="caption" tone="secondary">
                {t(MODE_LABELS[mode].key, MODE_LABELS[mode].fallback)}
              </AppText>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.chipRow}>
        <AppText variant="caption" tone="muted">
          {t('geofenceDrawer.actionsLabel', 'Configured actions')}
        </AppText>
        <View style={styles.chips}>
          {actions.map(action => (
            <View key={action} style={styles.actionChip}>
              <AppText variant="caption" tone="secondary">
                {action}
              </AppText>
            </View>
          ))}
        </View>
      </View>

      {fenceItems.length === 0 ? (
        <EmptyState
          title={t('geofenceDrawer.emptyTitle', 'No geofences')}
          message={t(
            'geofenceDrawer.emptyMessage',
            'Draw a geofence on the web app to see it summarized here.',
          )}
        />
      ) : (
        <View style={styles.fenceList}>
          {fenceItems.map(item => (
            <View
              key={item.key}
              accessible
              accessibilityLabel={item.description}
              style={styles.fenceRow}
              testID="geofence-drawer-fence">
              <View style={[styles.fenceSwatch, {backgroundColor: color}]} />
              <View style={styles.fenceCopy}>
                <View style={styles.fenceHeader}>
                  <AppText weight="semibold" style={styles.fenceName}>
                    {item.name}
                  </AppText>
                  <View style={[styles.typeChip, typeChipStyles[item.shape]]}>
                    <AppText variant="caption" tone="secondary">
                      {t(
                        SHAPE_LABELS[item.shape].key,
                        SHAPE_LABELS[item.shape].fallback,
                      )}
                    </AppText>
                  </View>
                </View>
                <AppText variant="caption" tone="secondary">
                  {item.description}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      )}
    </PremiumCard>
  );
}

GeofenceDrawer.displayName = 'GeofenceDrawer';

function buildActionLabels(
  handlers: Pick<GeofenceDrawerProps, 'onCreate' | 'onEdit' | 'onDelete'>,
  t: NativeTFunction,
): string[] {
  // onCreate is required, so drawing/create is always a configured action;
  // edit and delete mirror the source's `edit: onEdit ? … : false` and
  // `remove: !!onDelete` capability gating.
  const labels: string[] = [t('geofenceDrawer.action.create', 'Create')];
  if (handlers.onEdit) {
    labels.push(t('geofenceDrawer.action.edit', 'Edit'));
  }
  if (handlers.onDelete) {
    labels.push(t('geofenceDrawer.action.delete', 'Delete'));
  }
  return labels;
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

type FenceShape = 'circle' | 'polygon' | 'invalid';

/**
 * Classifies a fence by shape using the same validity rules the web original
 * applied in fenceToLayer(): a circle needs finite lat/lng and a positive
 * radius, a polygon needs a ring of at least three vertices; anything else is
 * not renderable. This replaces the Leaflet layer inspection in
 * layerToGeometry()/inferLayerType(), which has no native analog.
 */
function fenceShape(f: DrawableGeofence): FenceShape {
  if (
    typeof f.lat === 'number' &&
    typeof f.lng === 'number' &&
    typeof f.radius === 'number' &&
    f.radius > 0
  ) {
    return 'circle';
  }
  if (Array.isArray(f.polygon) && f.polygon.length >= 3) {
    return 'polygon';
  }
  return 'invalid';
}

/**
 * Build a human-readable accessible description for a fence.
 * Used by callers that surface fences in non-visual UI (lists, screen readers).
 */
export function describeFence(f: DrawableGeofence): string {
  if (
    typeof f.lat === 'number' &&
    typeof f.lng === 'number' &&
    typeof f.radius === 'number'
  ) {
    const name = f.name ?? 'Geofence';
    return `${name} — ${f.radius.toFixed(0)}m circle around ${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}`;
  }
  if (Array.isArray(f.polygon) && f.polygon.length >= 3) {
    const name = f.name ?? 'Geofence';
    return `${name} — ${f.polygon.length}-vertex polygon`;
  }
  return f.name ?? 'Geofence';
}

export default GeofenceDrawer;

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  notice: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: 16,
    padding: spacing.md,
    backgroundColor: colors.warningSurface,
  },
  noticeTitle: {
    color: colors.warning,
  },
  chipRow: {
    gap: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surfaceRaised,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  actionChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surfaceRaised,
  },
  fenceList: {
    gap: spacing.sm,
  },
  fenceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  fenceSwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    marginTop: 2,
  },
  fenceCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  fenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  fenceName: {
    flexShrink: 1,
  },
  typeChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});

const typeChipStyles = StyleSheet.create<Record<FenceShape, ViewStyle>>({
  circle: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  polygon: {
    borderColor: colors.violetBorder,
    backgroundColor: colors.violetSurface,
  },
  invalid: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
});
