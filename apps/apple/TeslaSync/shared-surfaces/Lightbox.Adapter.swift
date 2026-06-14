//
//  Lightbox.Adapter.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The testable, dependency-free projection core for the immersive image viewer — the faithful port of
//  `components/ui/Lightbox.tsx`. The web `<Lightbox>` is a controlled full-viewport viewer: it opens a single
//  image or navigates a sequence with ←/→, zooms 1x–5x in 0.5x steps (`0` resets), pans by drag once zoomed,
//  renders a "n / total" counter + caption, and overlays a decode skeleton until the image loads. All of the
//  rules that decide *what* the surface shows — the bounds-clamped navigation (web `Math.max(0, i-1)` /
//  `Math.min(total-1, i+1)`), the stepped + clamped zoom (web `LIGHTBOX_MIN/MAX/STEP`), the zoom-percent
//  readout (web `Math.round(zoom*100)`), the neighbour pre-warm indices (web `[-1, 1]`), and the resolved
//  view-ready projection — live here as pure value logic (Foundation/CoreGraphics only) so they are unit
//  testable without a rendered view, a store, or a bundle.
//
//  Faithful-parity note: the web `<Lightbox>` has NO data fetcher. Its only hooks are `useTranslation`
//  (→ the P1/S10 facade in Lightbox.Seams.swift) and `useId` (→ the dialog accessibility identity). There is
//  no React-Query cache, Promise, or live stream, so the surface has no *data* loading / error / stale /
//  offline branch — inventing such chrome would fabricate states the source does not have, exactly as the
//  sibling presentational primitives Accordion (0203), Delta (0081), and ActiveFilterChips (0147) declined to.
//  What the surface DOES have is a real *image* lifecycle: the web shows a skeleton until `onLoad`, and treats
//  `onError` as a finished (broken) load. That genuine async work is modelled by ``LightboxLoadPhase`` here
//  (loading → loaded → failed) and bound through the image-loader seam, giving the native peer a true loading
//  skeleton and a real error-with-retry envelope (which also covers an offline image fetch). The other real
//  branches reproduced: dismissed (`!open`), empty (`total === 0`), single image vs sequence (the ←/→ nav),
//  the at-first / at-last boundary disables, zoomed vs not (pan + the reset affordance), and caption present.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum LightboxSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Matches the prompt surface name.
    public static let slug = "Lightbox"
}

// MARK: - Zoom scale (web `LIGHTBOX_MIN/MAX/ZOOM_STEP`)

/// The zoom scale bounds + increment — the verbatim port of the web `LIGHTBOX_MIN_ZOOM` (1),
/// `LIGHTBOX_MAX_ZOOM` (5), and `LIGHTBOX_ZOOM_STEP` (0.5). The viewer zooms in fixed half-steps between 1x
/// and 5x; `0` (web) / reset snaps back to 1x.
public enum LightboxZoom {
    /// The minimum (rest) zoom scale — web `LIGHTBOX_MIN_ZOOM`.
    public static let minimum: Double = 1
    /// The maximum zoom scale — web `LIGHTBOX_MAX_ZOOM`.
    public static let maximum: Double = 5
    /// The per-tap zoom increment — web `LIGHTBOX_ZOOM_STEP`.
    public static let step: Double = 0.5
}

// MARK: - LightboxImage (web `LightboxImage`)

/// One viewable image — the native peer of the web `LightboxImage`: the source URL string (web `src`, also
/// the stable identity + pre-warm cache key), the required accessible description (web `alt`), and the
/// optional caption rendered below the frame (web `caption`). A value type so the view, the state-holder, and
/// the pure projection agree on one shape.
public struct LightboxImage: Sendable, Equatable, Identifiable {
    /// The image URL (web `src`). Doubles as the `Identifiable` id + the neighbour pre-warm cache key.
    public let source: String
    /// The accessible description (web `alt`). Required — an empty string is allowed for decorative images,
    /// but the field is always present so callers make a deliberate choice (matching the web prop contract).
    public let alt: String
    /// The optional caption rendered below the image (web `caption`).
    public let caption: String?

    public var id: String {
        source
    }

    public init(source: String, alt: String, caption: String? = nil) {
        self.source = source
        self.alt = alt
        self.caption = caption
    }
}

// MARK: - LightboxInput (web props, closure-free)

/// The component's props — the native peer of `LightboxProps`, minus the `onClose` closure (held by the view
/// + the state-holder). A value type so a SwiftUI `.onChange` can detect a prop change cheaply when the page
/// rebinds (e.g. a new `open`, a new image list, or a new `initialIndex`).
public struct LightboxInput: Sendable, Equatable {
    /// Whether the viewer is presented (web `open`). When `false` the surface renders nothing (web
    /// `if (!open) return null`).
    public let isOpen: Bool
    /// The sequence of images to navigate (web `images`). An empty array renders the friendly empty state.
    public let images: [LightboxImage]
    /// The image to show first (web `initialIndex`, default `0`). Re-applied on each closed→open transition
    /// and otherwise ignored; out-of-range values clamp to `0 … total-1`.
    public let initialIndex: Int

    public init(isOpen: Bool, images: [LightboxImage], initialIndex: Int = 0) {
        self.isOpen = isOpen
        self.images = images
        self.initialIndex = initialIndex
    }

    /// The number of images (web `total = images.length`).
    public var total: Int {
        images.count
    }

    /// The clamped first index (web `Math.min(Math.max(initialIndex, 0), Math.max(total - 1, 0))`).
    public var safeInitialIndex: Int {
        LightboxProjector.clampIndex(initialIndex, total: total)
    }
}

// MARK: - LightboxPan (web `pan {x, y}`)

/// The drag-to-pan translation applied while zoomed (web `pan = { x, y }`), in points. A small value type so
/// the pure projector + the state-holder share one shape and the reset-to-centre rule is unit testable.
public struct LightboxPan: Sendable, Equatable {
    public var x: Double
    public var y: Double

    public static let zero = LightboxPan(x: 0, y: 0)

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    /// Whether the image is offset from centre (web `pan.x !== 0 || pan.y !== 0`) — feeds the reset enable.
    public var isOffset: Bool {
        x != 0 || y != 0
    }
}

// MARK: - LightboxLoadPhase (web `decoded` + `onError`)

/// The current image's load lifecycle — the native peer of the web `decoded` flag plus `onError`. `loading`
/// is the web skeleton overlay (`!decoded`); `loaded` carries the decoded bytes (web `onLoad`); `failed` is
/// the web `onError` finished-but-broken load, surfaced natively as a retry-able error envelope (which also
/// covers an offline fetch). `Data` is `Sendable`, so the phase crosses the load actor boundary cleanly.
public enum LightboxLoadPhase: Sendable, Equatable {
    case loading
    case loaded(Data)
    case failed
}

// MARK: - LightboxProjection (view-ready)

/// The resolved, view-ready viewer chrome — everything the SwiftUI body needs as a pure function of the
/// index, the image count, the zoom scale, and the pan offset (no derivation in the view). Mirrors the web
/// render decisions: `isFirst`/`isLast` are the web `atFirst`/`atLast` nav disables, `showsNavigation` is the
/// web `{total > 1 && …}`, `canZoomIn`/`canZoomOut` are the web `zoom < MAX` / `zoom > MIN`, `isZoomed` is the
/// web `zoom > 1`, `canReset` is the web `isZoomed || pan.x || pan.y`, and `zoomPercent` is the web
/// `Math.round(zoom * 100)`.
public struct LightboxProjection: Sendable, Equatable {
    public let index: Int
    public let total: Int
    public let isFirst: Bool
    public let isLast: Bool
    public let showsNavigation: Bool
    public let zoom: Double
    public let canZoomIn: Bool
    public let canZoomOut: Bool
    public let isZoomed: Bool
    public let canReset: Bool
    public let zoomPercent: Int

    public init(
        index: Int,
        total: Int,
        isFirst: Bool,
        isLast: Bool,
        showsNavigation: Bool,
        zoom: Double,
        canZoomIn: Bool,
        canZoomOut: Bool,
        isZoomed: Bool,
        canReset: Bool,
        zoomPercent: Int
    ) {
        self.index = index
        self.total = total
        self.isFirst = isFirst
        self.isLast = isLast
        self.showsNavigation = showsNavigation
        self.zoom = zoom
        self.canZoomIn = canZoomIn
        self.canZoomOut = canZoomOut
        self.isZoomed = isZoomed
        self.canReset = canReset
        self.zoomPercent = zoomPercent
    }
}

// MARK: - LightboxProjector (web render body)

/// The pure projection from the viewer state (index / count / zoom / pan) to the view-ready model — the
/// surface's data adapter in the "state → projection" sense the acceptance calls for. It takes the values the
/// state-holder already owns (no fetch, no clock) and derives the rendered viewer chrome, plus the bounded
/// navigation + stepped zoom transitions. Unit tested across the index clamp, the ←/→/Home/End moves, the
/// zoom step + clamp, the percent readout, the neighbour indices, and the full projection.
public enum LightboxProjector {
    /// Clamps an index into `0 … total-1` (web `Math.min(Math.max(i, 0), Math.max(total - 1, 0))`). Empty
    /// lists clamp to `0`.
    public static func clampIndex(_ index: Int, total: Int) -> Int {
        min(max(index, 0), max(total - 1, 0))
    }

    /// The previous index (web `goPrev` → `Math.max(0, i - 1)`).
    public static func previousIndex(_ index: Int) -> Int {
        max(0, index - 1)
    }

    /// The next index (web `goNext` → `Math.min(total - 1, i + 1)`).
    public static func nextIndex(_ index: Int, total: Int) -> Int {
        min(max(total - 1, 0), index + 1)
    }

    /// The first index (web `goFirst` → `0`).
    public static func firstIndex() -> Int {
        0
    }

    /// The last index (web `goLast` → `Math.max(0, total - 1)`).
    public static func lastIndex(total: Int) -> Int {
        max(0, total - 1)
    }

    /// Rounds a zoom scale to 2 decimals — the verbatim port of the web `+(z).toFixed(2)` that keeps the
    /// half-step arithmetic free of binary-float drift (e.g. `1 + 0.5 + 0.5` stays exact).
    public static func round2(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }

    /// The zoomed-in scale (web `zoomIn` → `Math.min(MAX, +(z + STEP).toFixed(2))`).
    public static func zoomedIn(_ zoom: Double) -> Double {
        min(LightboxZoom.maximum, round2(zoom + LightboxZoom.step))
    }

    /// The zoomed-out scale (web `zoomOut` → `Math.max(MIN, +(z - STEP).toFixed(2))`).
    public static func zoomedOut(_ zoom: Double) -> Double {
        max(LightboxZoom.minimum, round2(zoom - LightboxZoom.step))
    }

    /// Whether zooming in is possible (web `zoom < LIGHTBOX_MAX_ZOOM`).
    public static func canZoomIn(_ zoom: Double) -> Bool {
        zoom < LightboxZoom.maximum
    }

    /// Whether zooming out is possible (web `zoom > LIGHTBOX_MIN_ZOOM`).
    public static func canZoomOut(_ zoom: Double) -> Bool {
        zoom > LightboxZoom.minimum
    }

    /// Whether the image is magnified (web `isZoomed = zoom > 1`) — gates the drag-to-pan surface.
    public static func isZoomed(_ zoom: Double) -> Bool {
        zoom > LightboxZoom.minimum
    }

    /// The zoom percentage readout (web `Math.round(zoom * 100)`).
    public static func zoomPercent(_ zoom: Double) -> Int {
        Int((zoom * 100).rounded())
    }

    /// Whether the reset control is enabled (web `isZoomed || pan.x !== 0 || pan.y !== 0`).
    public static func canReset(zoom: Double, pan: LightboxPan) -> Bool {
        isZoomed(zoom) || pan.isOffset
    }

    /// The in-range neighbour indices to pre-warm (web `[-1, 1]` offsets filtered to `0 … total-1`), so ←/→
    /// navigation finds the bytes already in the cache.
    public static func neighbourIndices(index: Int, total: Int) -> [Int] {
        [index - 1, index + 1].filter { $0 >= 0 && $0 < total }
    }

    /// The current image (web `images[Math.min(index, total - 1)]`), or `nil` when the list is empty.
    public static func resolvedImage(images: [LightboxImage], index: Int) -> LightboxImage? {
        guard !images.isEmpty else { return nil }
        return images[min(max(index, 0), images.count - 1)]
    }

    /// Resolves the whole viewer chrome from the current state — the native peer of the web render decision.
    public static func resolve(index: Int, total: Int, zoom: Double, pan: LightboxPan) -> LightboxProjection {
        LightboxProjection(
            index: index,
            total: total,
            isFirst: index <= 0,
            isLast: index >= total - 1,
            showsNavigation: total > 1,
            zoom: zoom,
            canZoomIn: canZoomIn(zoom),
            canZoomOut: canZoomOut(zoom),
            isZoomed: isZoomed(zoom),
            canReset: canReset(zoom: zoom, pan: pan),
            zoomPercent: zoomPercent(zoom)
        )
    }
}
