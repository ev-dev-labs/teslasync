// Native parity port of web/src/components/maps/vehicleIcon.ts.
//
// The web module is a factory that returns a Leaflet `L.divIcon` — a CSS-only
// marker glyph (a pulsing, theme-colored dot with a glowing, white-bordered
// core) consumed as `<Marker icon={vehicleIcon()} />`. Leaflet, plus the DOM
// `<div>` / `<style>` / CSS `@keyframes` markup it emits, are browser-only
// (conversion contract rule 4) and there is NO Leaflet map host in the native
// parity tree, so an `L.DivIcon` cannot exist here (rule 7). Faithful to the
// source's actual shape — a configuration factory, not a React component
// (rule 6) — `vehicleIcon()` is ported to return a native-safe
// `VehicleIconSpec` descriptor that captures every visual value from the web
// icon (icon/anchor/popup geometry, the two layered circles, and the
// `vehicle-pulse` keyframe) so a native map marker layer can reproduce the
// glyph. The live, animated equivalent of this pulsing dot is already rendered
// by the sibling `AnimatedMarker` parity component. See the .parity.json
// sidecar for the line-by-line source map.

/** Default theme color — identical to the web `vehicleIcon(color = '#00f0ff')`. */
export const VEHICLE_ICON_DEFAULT_COLOR = '#00f0ff';

/** Icon box edge in px — the web Leaflet `iconSize: [28, 28]`. */
export const VEHICLE_ICON_SIZE = 28;

/**
 * Native-safe description of the `vehicle-pulse` keyframe the web icon injects
 * via a `<style>` tag. No DOM/CSS animation engine exists natively, so the
 * keyframe is carried as data a native driver (e.g. `Animated`) can replay.
 */
export interface VehicleIconPulseAnimation {
  /** Keyframe name from the web `@keyframes vehicle-pulse`. */
  name: 'vehicle-pulse';
  /** Cycle length in ms — the web `2s`. */
  durationMs: number;
  /** Timing function — the web `ease-in-out`. */
  easing: 'ease-in-out';
  /** Repeat mode — the web `infinite`. */
  iterations: 'infinite';
  /** Scale at the 0% / 100% keyframes (`scale(1)`). */
  fromScale: number;
  /** Scale at the 50% keyframe (`scale(1.6)`). */
  toScale: number;
  /** Opacity at the 0% / 100% keyframes (`0.25`). */
  fromOpacity: number;
  /** Opacity at the 50% keyframe (`0`). */
  toOpacity: number;
}

/**
 * Native-safe descriptor for the vehicle marker glyph. Replaces the web
 * `L.DivIcon`; every field maps 1:1 to a Leaflet option or inline CSS value.
 */
export interface VehicleIconSpec {
  /** [width, height] in px — the web `iconSize: [28, 28]`. */
  size: [number, number];
  /** [x, y] anchor (glyph center) — the web `iconAnchor: [14, 14]`. */
  anchor: [number, number];
  /** [x, y] popup anchor — the web `popupAnchor: [0, -14]`. */
  popupAnchor: [number, number];
  /** Theme color shared by both layers. */
  color: string;
  /** Outer pulsing ring — the first `<div>` (full size, faint, animated). */
  pulse: {
    color: string;
    /** Base opacity — the web `opacity: 0.25`. */
    opacity: number;
    /** Inset from the icon box edge in px — the web `inset: 0`. */
    inset: number;
    animation: VehicleIconPulseAnimation;
  };
  /** Inner core dot — the second `<div>` (inset, bordered, glowing). */
  core: {
    color: string;
    /** Inset from the icon box edge in px — the web `inset: 5px`. */
    inset: number;
    /** Border color — the web `border: 2px solid white`. */
    borderColor: string;
    /** Border width in px — the web `2px`. */
    borderWidth: number;
    /** Glow color — the web `box-shadow: 0 0 10px ${color}`. */
    glowColor: string;
    /** Glow radius in px — the web `box-shadow` blur of `10px`. */
    glowRadius: number;
  };
}

/**
 * Custom vehicle marker icon — replaces broken default Leaflet markers.
 * Renders as a pulsing dot with a theme-colored glow.
 *
 * Web parity: returns a descriptor instead of an `L.DivIcon` because Leaflet and
 * its DOM/CSS output are unavailable natively. A native map marker consumes the
 * returned geometry/colors/animation to draw the identical glyph.
 */
export function vehicleIcon(
  color = VEHICLE_ICON_DEFAULT_COLOR,
): VehicleIconSpec {
  return {
    size: [VEHICLE_ICON_SIZE, VEHICLE_ICON_SIZE],
    anchor: [VEHICLE_ICON_SIZE / 2, VEHICLE_ICON_SIZE / 2],
    popupAnchor: [0, -VEHICLE_ICON_SIZE / 2],
    color,
    pulse: {
      color,
      opacity: 0.25,
      inset: 0,
      animation: {
        name: 'vehicle-pulse',
        durationMs: 2000,
        easing: 'ease-in-out',
        iterations: 'infinite',
        fromScale: 1,
        toScale: 1.6,
        fromOpacity: 0.25,
        toOpacity: 0,
      },
    },
    core: {
      color,
      inset: 5,
      borderColor: '#ffffff',
      borderWidth: 2,
      glowColor: color,
      glowRadius: 10,
    },
  };
}
