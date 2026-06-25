// Native parity port of web/src/components/maps/MapTileLayer.tsx.
//
// The web module is built entirely on react-leaflet (`TileLayer`, `useMap`),
// `react-dom`'s `createPortal`, and the browser Fullscreen API. None of those
// have an equivalent in this native dependency set (no react-native-maps /
// leaflet is installed), so the interactive raster tile grid and the DOM
// portal cannot be reproduced. Instead this port:
//   - preserves the exported `MapStyle` union and the full tile-resolution
//     logic (freeTiles / azureTiles / googleTiles + provider selection) so the
//     same provider/style/api_key inputs resolve to the same tile URL +
//     attribution as on web,
//   - preserves the `['map-config']` TanStack Query (queryFn `getMapConfig`
//     hitting `/system/map-config`, staleTime 5 min),
//   - renders the resolved tile metadata on an explicit native-safe surface
//     that documents that the live tile raster is unavailable on native,
//   - keeps `MapInvalidator` as a render-nothing no-op (the web component also
//     returns null; Leaflet's `invalidateSize()` has no native counterpart),
//   - keeps `MapFullscreenControl` (props, corner positioning, enter/exit
//     labels) but surfaces an explicit "fullscreen unavailable on native"
//     notice instead of toggling the browser Fullscreen API.
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {getMapConfig, type MapConfig} from '../../api/settings';

export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain';

interface MapTileLayerProps {
  style?: MapStyle;
  /** Native-only convenience for laying out the placeholder surface. */
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

type TileDef = {url: string; attribution: string};

const freeTiles: Record<MapStyle, TileDef> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>', // i18n-ignore (brand name in HTML attribution required by tile provider terms)
  },
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', // i18n-ignore (brand name)
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>', // i18n-ignore (brand name)
  },
};

function azureTiles(key: string): Record<MapStyle, TileDef> {
  const base =
    'https://atlas.microsoft.com/map/tile?api-version=2024-04-01&subscription-key=' +
    key;
  return {
    dark: {
      url: `${base}&tilesetId=microsoft.base.darkgrey&zoom={z}&x={x}&y={y}`,
      attribution: '&copy; Azure Maps',
    },
    streets: {
      url: `${base}&tilesetId=microsoft.base.road&zoom={z}&x={x}&y={y}`,
      attribution: '&copy; Azure Maps',
    },
    satellite: {
      url: `${base}&tilesetId=microsoft.imagery&zoom={z}&x={x}&y={y}`,
      attribution: '&copy; Azure Maps',
    },
    terrain: {
      url: `${base}&tilesetId=microsoft.base.road&zoom={z}&x={x}&y={y}`,
      attribution: '&copy; Azure Maps',
    },
  };
}

function googleTiles(key: string): Record<MapStyle, TileDef> {
  return {
    dark: {
      url: `https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}&key=${key}`,
      attribution: '&copy; Google Maps',
    },
    streets: {
      url: `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${key}`,
      attribution: '&copy; Google Maps',
    },
    satellite: {
      url: `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&key=${key}`,
      attribution: '&copy; Google Maps',
    },
    terrain: {
      url: `https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&key=${key}`,
      attribution: '&copy; Google Maps',
    },
  };
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/** Resolve the active tile set from the fetched map config, mirroring the web
 * provider-selection branch (azure → google → free fallback). */
function resolveTiles(mapConfig: MapConfig | undefined): Record<MapStyle, TileDef> {
  if (mapConfig?.provider === 'azure' && mapConfig.api_key) {
    return azureTiles(mapConfig.api_key);
  }
  if (mapConfig?.provider === 'google' && mapConfig.api_key) {
    return googleTiles(mapConfig.api_key);
  }
  return freeTiles;
}

/** Convert the HTML attribution string used by Leaflet into plain text for a
 * native `<AppText>` (decodes `&copy;`, strips anchor markup). */
function attributionText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&copy;/g, '\u00A9')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function MapTileLayer({
  style = 'dark',
  containerStyle,
  testID,
}: MapTileLayerProps) {
  const t = useNativeTranslationFallback();
  const {data: mapConfig} = useQuery({
    queryKey: ['map-config'],
    queryFn: getMapConfig,
    staleTime: 5 * 60 * 1000,
  });

  const tiles = useMemo(() => resolveTiles(mapConfig), [mapConfig]);
  const tile = tiles[style] || tiles.dark;
  const attribution = useMemo(
    () => attributionText(tile.attribution),
    [tile.attribution],
  );
  const provider = mapConfig?.provider ?? 'free';

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t(
        'map.tileLayer.nativeLabel',
        'Map tile preview (interactive tiles unavailable on native)',
      )}
      style={[styles.surface, containerStyle]}
      testID={testID ?? 'map-tile-layer'}>
      <AppText style={styles.surfaceTitle} variant="caption" weight="semibold">
        {t('map.tileLayer.title', 'Map preview')}
      </AppText>
      <AppText style={styles.surfaceBody} variant="caption" tone="secondary">
        {t(
          'map.tileLayer.nativeUnavailable',
          'Interactive map tiles are unavailable in this native parity component.',
        )}
      </AppText>

      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <AppText style={styles.badgeText} variant="caption">
            {t('map.tileLayer.style', 'Style')}: {style}
          </AppText>
        </View>
        <View style={styles.badge}>
          <AppText style={styles.badgeText} variant="caption">
            {t('map.tileLayer.provider', 'Provider')}: {provider}
          </AppText>
        </View>
      </View>

      <AppText
        numberOfLines={2}
        style={styles.attribution}
        tone="muted"
        variant="caption">
        {attribution}
      </AppText>
    </View>
  );
}

MapTileLayer.displayName = 'MapTileLayer';

/**
 * Forces Leaflet to recalculate tile positions after the container mounts or
 * resizes. Leaflet's `invalidateSize()` has no React Native equivalent (native
 * map views own their own layout), so — like the web component — this renders
 * nothing.
 */
export function MapInvalidator(): null {
  return null;
}

MapInvalidator.displayName = 'MapInvalidator';

export interface MapFullscreenControlProps {
  /**
   * Corner of the map to mount the button in. Defaults to `topright`. RTL pages
   * typically pass `topleft` so the control stays on the page's "trailing edge"
   * in the user's reading direction.
   */
  position?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
  /** Override the "Enter fullscreen" accessible label. */
  ariaLabelEnter?: string;
  /** Override the "Exit fullscreen" accessible label. */
  ariaLabelExit?: string;
}

const POSITION_STYLE: Record<
  NonNullable<MapFullscreenControlProps['position']>,
  ViewStyle
> = {
  topleft: {top: spacing.sm, left: spacing.sm},
  topright: {top: spacing.sm, right: spacing.sm},
  bottomleft: {bottom: spacing.sm, left: spacing.sm},
  bottomright: {bottom: spacing.sm, right: spacing.sm},
};

/**
 * Native-safe stand-in for the leaflet fullscreen overlay. The web component
 * portals a `<FullscreenButton>` into the leaflet container's DOM and drives
 * the browser Fullscreen API on `fullscreenchange`. React Native has no
 * element-level fullscreen, so the control keeps its corner positioning and
 * enter/exit labels but surfaces an explicit unavailable notice on press; the
 * tracked fullscreen state never becomes active.
 */
export function MapFullscreenControl({
  position = 'topright',
  ariaLabelEnter,
  ariaLabelExit,
}: MapFullscreenControlProps) {
  const t = useNativeTranslationFallback();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(false);

  const enterLabel =
    ariaLabelEnter ?? t('common.fullscreen.enter', 'Enter fullscreen');
  const exitLabel =
    ariaLabelExit ?? t('common.fullscreen.exit', 'Exit fullscreen');
  const label = isFullscreen ? exitLabel : enterLabel;

  const handlePress = useCallback(() => {
    // Browser element-level fullscreen is unavailable on native; surface an
    // explicit notice instead of toggling, so the state stays "not fullscreen".
    setNoticeVisible(true);
    setIsFullscreen(false);
  }, []);

  return (
    <View pointerEvents="box-none" style={[styles.control, POSITION_STYLE[position]]}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{selected: isFullscreen}}
        onPress={handlePress}
        style={styles.fsButton}
        testID="map-fullscreen-button">
        <AppText style={styles.fsGlyph} variant="caption" weight="semibold">
          {isFullscreen ? '\u2715' : '\u26F6'}
        </AppText>
      </Pressable>

      {noticeVisible ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="text"
          style={styles.notice}>
          <AppText style={styles.noticeText} tone="secondary" variant="caption">
            {t(
              'map.fullscreen.nativeUnavailable',
              'Fullscreen maps are unavailable in this native parity component.',
            )}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

MapFullscreenControl.displayName = 'MapFullscreenControl';

const styles = StyleSheet.create({
  attribution: {
    bottom: spacing.xs,
    position: 'absolute',
    right: spacing.sm,
    textAlign: 'right',
  },
  badge: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  badgeText: {
    color: colors.textSecondary,
  },
  control: {
    alignItems: 'flex-end',
    position: 'absolute',
    zIndex: 800,
  },
  fsButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  fsGlyph: {
    color: colors.textPrimary,
  },
  notice: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.xs,
    maxWidth: 220,
    padding: spacing.xs,
  },
  noticeText: {
    color: colors.textSecondary,
  },
  surface: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 180,
    overflow: 'hidden',
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    position: 'relative',
  },
  surfaceBody: {
    color: colors.textSecondary,
  },
  surfaceTitle: {
    color: colors.textPrimary,
  },
});
