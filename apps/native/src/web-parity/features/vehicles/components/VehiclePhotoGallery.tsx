// Native parity port of web/src/features/vehicles/components/VehiclePhotoGallery.tsx.
//
// A display-only vehicle photo gallery: an empty-state placeholder card when
// there are no photos, otherwise a responsive grid of tappable thumbnails that
// open an immersive image viewer. The web file leans on browser-only
// dependencies that are absent from the native parity manifest (contract rules
// 4, 5 & 7); each is replaced with a React Native-safe equivalent and documented
// here + in the sidecar:
//
//   - @/components/ui/Lightbox `Lightbox` + `type LightboxImage` (web L15) ->
//     the shared native Lightbox is NOT yet ported (it is a PENDING entry in
//     the native web-parity components/ui barrel, converted in its own per-file
//     pass). So this file (a) defines a local `LightboxImage` interface with the
//     exact web shape ({ src; alt; caption? }) and re-exports it so the Props
//     type stays usable, and (b) implements a local native-safe `Lightbox`
//     (React Native `Modal`) that reproduces the gallery's observable behaviour:
//     the closed->open index reset (wasOpenRef), the goPrev/goNext clamp
//     (Math.max(0, i-1) / Math.min(total-1, i+1)), the "{{current}} / {{total}}"
//     counter, the close affordance, the prev/next controls (rendered only when
//     total > 1, disabled at the first/last image), the caption row, and
//     backdrop-tap + Android-back close. The web Lightbox's advanced extras
//     (1x-5x zoom + pan, ←/→ keyboard nav, DOM focus-trap, createPortal,
//     neighbour-image pre-warm) are browser-leaning and belong to the Lightbox's
//     own future per-file native pass; they are intentionally out of scope for
//     this display-only wrapper, which only needs open/navigate/close. The
//     web i18n keys (lightbox.counter / .close / .previous / .next) are
//     preserved verbatim.
//   - react-i18next `useTranslation` (web L12, L35) -> inlined
//     useNativeTranslation(): a (key, fallback, vars?) => string shim that
//     returns the English fallback and interpolates i18next `{{var}}`
//     placeholders, so every t() call keeps its key intent, English default, AND
//     variable substitution (vehicles.photos.galleryNamed {{name}},
//     vehicles.photos.openAt {{index}}/{{total}}).
//   - lucide-react `Image as ImageIcon` (web L13, L49-52, aria-hidden) -> a
//     decorative monochrome `PhotoGlyph` built from React Native Views (a framed
//     rounded square + a "sun" dot + a diagonal "mountain" bar), matching the
//     lucide image-icon silhouette in muted colour, the same View-drawn-glyph
//     approach the sibling Avatar.UserGlyph port uses. The web bare icon has no
//     border box, so this stays a flat monochrome mark (no SemanticIcon chip).
//   - @/lib/cn `cn` + the `className` passthrough (web L16, L27, L33, L43-47,
//     L72) -> React Native `StyleSheet` style arrays. The web `className` escape
//     hatch becomes an optional `style?: StyleProp<ViewStyle>` merged onto the
//     outer wrapper at the same position cn() appended it; `className?: string`
//     is kept (inert) only to preserve the web prop shape one-for-one.
//   - HTML `<div>`/`<ul>`/`<li>` -> `View`; `<button>` -> `Pressable`; `<img>`
//     -> React Native `Image` source={{uri}} (the established TOTPEnrollmentSection
//     / Avatar uri-Image pattern); `<p>` -> `AppText`. `data-testid` -> `testID`.
//   - Tailwind `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4` (web L81) -> a
//     flex-wrap grid whose column count follows the Tailwind sm(640)/md(768)
//     breakpoints via useWindowDimensions, with the square thumbnail size derived
//     from the grid's measured width (onLayout). The desktop-only group-hover
//     image zoom + focus-visible ring (web L97, L105) map to a Pressable
//     pressed-state dim (touch has no hover/focus-ring).
//
// No DOM-only modules, HTML elements, react-router-dom, react-i18next,
// lucide-react, Recharts, Leaflet, createPortal, or web @/ UI imports remain --
// only react, react-native primitives (Image/Modal/Pressable/StyleSheet/View/
// useWindowDimensions), the shared native AppText, and the theme tokens.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';

/**
 * Native mirror of the web `@/components/ui/Lightbox` `LightboxImage` shape.
 * Defined locally (and re-exported) because the shared native Lightbox is not
 * yet ported; when it lands in its own pass it owns the canonical export.
 */
export interface LightboxImage {
  /** Image URL (any platform-supported format). */
  src: string;
  /** Accessible alt text for the image. */
  alt: string;
  /** Optional caption rendered below the image. */
  caption?: string;
}

// ── react-i18next useTranslation replacement (with {{var}} interpolation) ──
type NativeTVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: NativeTVars,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders from the vars object. */
function interpolate(template: string, vars?: NativeTVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Returns the English fallback (interpolated) so the key intent is preserved. */
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, vars?: NativeTVars) =>
      interpolate(fallback, vars),
    [],
  );
}

/** lucide-react ChevronLeft / ChevronRight -> single-glyph chevrons. */
const CHEVRON_LEFT = '\u2039';
const CHEVRON_RIGHT = '\u203A';
/** Close affordance glyph (the dismiss glyph the Drawer / ContextMenu ports use). */
const CLOSE_GLYPH = '\u2715';

/** gap-3 between thumbnails (web L81). */
const GRID_GAP = 12;
/** Tailwind sm / md breakpoints driving the responsive column count (web L81). */
const SM_BREAKPOINT = 640;
const MD_BREAKPOINT = 768;

/**
 * lucide-react `Image` empty-state icon (web L49-52, decorative/aria-hidden) ->
 * a monochrome framed-picture mark drawn from Views (frame + sun dot + mountain
 * bar), matching the lucide silhouette in muted colour without a border chip.
 */
function PhotoGlyph() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.photoGlyph}>
      <View style={styles.photoGlyphDot} />
      <View style={styles.photoGlyphMountain} />
    </View>
  );
}

interface LightboxProps {
  open: boolean;
  onClose: () => void;
  images: LightboxImage[];
  initialIndex?: number;
}

/**
 * Local native-safe Lightbox (the shared one is not yet ported). Reproduces the
 * web Lightbox's core viewing behaviour with a React Native Modal: open-at-index
 * reset, clamped prev/next navigation, counter, caption, and close.
 */
function Lightbox({open, onClose, images, initialIndex = 0}: LightboxProps) {
  const t = useNativeTranslation();
  const total = images.length;
  const safeInitialIndex = Math.min(
    Math.max(initialIndex, 0),
    Math.max(total - 1, 0),
  );

  const [index, setIndex] = useState(safeInitialIndex);
  const wasOpenRef = useRef(false);

  // Reset the index on the closed->open transition only (web L113-121): once the
  // user has navigated we must not snap back on a stale initialIndex re-render.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setIndex(safeInitialIndex);
    }
    wasOpenRef.current = open;
  }, [open, safeInitialIndex]);

  const goPrev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setIndex(i => Math.min(total - 1, i + 1)),
    [total],
  );

  if (!open || total === 0) {
    return null;
  }

  const current = images[Math.min(index, total - 1)];
  if (!current) {
    return null;
  }

  const atFirst = index === 0;
  const atLast = index === total - 1;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible>
      <View style={styles.lbRoot}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.lbBackdrop}
          testID="lightbox-backdrop"
        />

        <View pointerEvents="box-none" style={styles.lbContent}>
          {/* Top bar — counter (left) + close (right). */}
          <View pointerEvents="box-none" style={styles.lbTopBar}>
            <AppText style={styles.lbCounter} testID="lightbox-counter">
              {t('lightbox.counter', '{{current}} / {{total}}', {
                current: index + 1,
                total,
              })}
            </AppText>
            <Pressable
              accessibilityLabel={t('lightbox.close', 'Close image viewer')}
              accessibilityRole="button"
              onPress={onClose}
              style={({pressed}) => [
                styles.lbIconButton,
                pressed && styles.pressedSurface,
              ]}>
              <AppText style={styles.lbCloseIcon}>{CLOSE_GLYPH}</AppText>
            </Pressable>
          </View>

          {/* Image area — prev (left) + image + next (right). */}
          <View pointerEvents="box-none" style={styles.lbCenter}>
            {total > 1 ? (
              <Pressable
                accessibilityLabel={t('lightbox.previous', 'Previous image')}
                accessibilityRole="button"
                accessibilityState={{disabled: atFirst}}
                disabled={atFirst}
                onPress={goPrev}
                style={({pressed}) => [
                  styles.lbNav,
                  atFirst && styles.lbNavDisabled,
                  pressed && !atFirst && styles.pressedSurface,
                ]}
                testID="lightbox-prev">
                <AppText style={styles.lbNavIcon}>{CHEVRON_LEFT}</AppText>
              </Pressable>
            ) : null}

            <View style={styles.lbImageWrap}>
              <Image
                accessibilityIgnoresInvertColors
                accessibilityLabel={current.alt}
                resizeMode="contain"
                source={{uri: current.src}}
                style={styles.lbImage}
                testID="lightbox-image"
              />
            </View>

            {total > 1 ? (
              <Pressable
                accessibilityLabel={t('lightbox.next', 'Next image')}
                accessibilityRole="button"
                accessibilityState={{disabled: atLast}}
                disabled={atLast}
                onPress={goNext}
                style={({pressed}) => [
                  styles.lbNav,
                  atLast && styles.lbNavDisabled,
                  pressed && !atLast && styles.pressedSurface,
                ]}
                testID="lightbox-next">
                <AppText style={styles.lbNavIcon}>{CHEVRON_RIGHT}</AppText>
              </Pressable>
            ) : null}
          </View>

          {/* Bottom bar — caption. */}
          <View pointerEvents="box-none" style={styles.lbBottomBar}>
            {current.caption ? (
              <AppText style={styles.lbCaption} testID="lightbox-caption">
                {current.caption}
              </AppText>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export interface VehiclePhotoGalleryProps {
  /** Vehicle photos to render. Defaults to an empty array. */
  photos?: LightboxImage[];
  /**
   * Optional vehicle display name, used to compose accessible labels
   * such as "Open photo 3 of 7 — Model 3 Performance".
   */
  vehicleName?: string;
  /**
   * Inert web-parity passthrough (the web `className`). Kept so the prop shape
   * matches the web one-for-one; use `style` for native styling.
   */
  className?: string;
  /** Native escape hatch — extra style merged onto the outer wrapper. */
  style?: StyleProp<ViewStyle>;
}

export function VehiclePhotoGallery({
  photos = [],
  vehicleName,
  className: _className,
  style,
}: VehiclePhotoGalleryProps) {
  const t = useNativeTranslation();
  const {width} = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [gridWidth, setGridWidth] = useState(0);

  if (photos.length === 0) {
    return (
      <View style={[styles.emptyCard, style]} testID="vehicle-photo-gallery-empty">
        <PhotoGlyph />
        <AppText style={styles.emptyTitle}>
          {t('vehicles.photos.empty', 'No photos uploaded yet.')}
        </AppText>
        <AppText style={styles.emptyHelp}>
          {t(
            'vehicles.photos.emptyHelp',
            'Photos uploaded for this vehicle will appear here.',
          )}
        </AppText>
      </View>
    );
  }

  const handleOpen = (i: number) => {
    setActiveIndex(i);
    setOpen(true);
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.width;
    setGridWidth(prev => (Math.abs(prev - measured) < 1 ? prev : measured));
  };

  const columns = width >= MD_BREAKPOINT ? 4 : width >= SM_BREAKPOINT ? 3 : 2;
  const itemSize =
    gridWidth > 0
      ? Math.floor((gridWidth - GRID_GAP * (columns - 1)) / columns)
      : 0;

  const galleryLabel = vehicleName
    ? t('vehicles.photos.galleryNamed', '{{name}} photo gallery', {
        name: vehicleName,
      })
    : t('vehicles.photos.gallery', 'Photo gallery');

  return (
    <View style={style} testID="vehicle-photo-gallery">
      <View
        accessibilityLabel={galleryLabel}
        onLayout={handleLayout}
        style={styles.grid}>
        {photos.map((photo, i) => (
          <Pressable
            accessibilityLabel={t(
              'vehicles.photos.openAt',
              'Open photo {{index}} of {{total}}',
              {index: i + 1, total: photos.length},
            )}
            accessibilityRole="button"
            key={`${photo.src}-${i}`}
            onPress={() => handleOpen(i)}
            style={({pressed}) => [
              styles.thumb,
              {height: itemSize, width: itemSize},
              pressed && styles.thumbPressed,
            ]}
            testID={`vehicle-photo-thumb-${i}`}>
            <Image
              accessibilityIgnoresInvertColors
              resizeMode="cover"
              source={{uri: photo.src}}
              style={styles.thumbImage}
            />
          </Pressable>
        ))}
      </View>

      <Lightbox
        images={photos}
        initialIndex={activeIndex}
        onClose={() => setOpen(false)}
        open={open}
      />
    </View>
  );
}

VehiclePhotoGallery.displayName = 'VehiclePhotoGallery';

const styles = StyleSheet.create({
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  emptyHelp: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  lbBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 7, 13, 0.96)',
  },
  lbBottomBar: {
    alignItems: 'center',
    gap: 8,
    paddingBottom: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  lbCaption: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 768,
    textAlign: 'center',
  },
  lbCenter: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  lbCloseIcon: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 20,
  },
  lbContent: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  lbCounter: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  lbIconButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  lbImage: {
    height: '100%',
    width: '100%',
  },
  lbImageWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  lbNav: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginHorizontal: 8,
    width: 48,
  },
  lbNavDisabled: {
    opacity: 0.4,
  },
  lbNavIcon: {
    color: colors.textPrimary,
    fontSize: 28,
    lineHeight: 30,
  },
  lbRoot: {
    flex: 1,
  },
  lbTopBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  photoGlyph: {
    borderColor: colors.textMuted,
    borderRadius: 6,
    borderWidth: 2,
    height: 34,
    overflow: 'hidden',
    width: 34,
  },
  photoGlyphDot: {
    backgroundColor: colors.textMuted,
    borderRadius: 3,
    height: 6,
    left: 6,
    position: 'absolute',
    top: 6,
    width: 6,
  },
  photoGlyphMountain: {
    backgroundColor: colors.textMuted,
    bottom: 6,
    height: 2.5,
    left: 3,
    position: 'absolute',
    transform: [{rotate: '-22deg'}],
    width: 26,
  },
  pressedSurface: {
    backgroundColor: colors.surfaceRaised,
  },
  thumb: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  thumbImage: {
    height: '100%',
    width: '100%',
  },
  thumbPressed: {
    opacity: 0.85,
  },
});
