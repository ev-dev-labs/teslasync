//
//  DataTableResizer.Adapter.swift
//  TeslaSync — P4 shared surface · 0212 · DataTableResizer (Apple)
//
//  The Foundation-only core for the column-resize handle — the SwiftUI parity of
//  `components/ui/DataTableResizer.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam, the props value type (``DataTableResizerInput``), the view-ready
//  ``DataTableResizerProjection``, and the pure ``DataTableResizerProjector`` that resolves the verbatim
//  web rules: the `clamp` (web `Math.max(minWidth, Math.min(maxWidth, Math.round(n)))`), the drag-delta
//  width (web `clamp(startWidth + delta)`), the ±8 px arrow step / Home-80 / End-max keyboard splitter, and
//  the hover / focus / drag handle opacity. No SwiftUI and no `@Observable`, so every rule is unit-testable
//  in isolation.
//
//  Faithful-parity note: the web `<DataTableResizer>` is a PURE presentational primitive. It takes its data
//  as plain props (`columnKey`, `width`, `minWidth`, `maxWidth`, the `onResize` / `onResizeEnd` callbacks,
//  `label`) and renders a drag handle — there is no fetch, no React-Query cache, and no Promise — so it has
//  NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age, or lose connectivity
//  to; the hosting `<th>` owns its own data states). Inventing such chrome would fabricate states the
//  source does not have, so this surface reproduces only the source's REAL branches — exactly as the
//  sibling presentational primitives DataTableBulkBar (0209), Accordion (0203), ActiveFilterChips (0147),
//  InlineCallout (0124), Delta (0081), and MetricCard (0095) did. The REAL branches: the resting (invisible
//  until hover/focus) handle, the hover tint, the focus tint, the dragging tint, and the min/max clamp
//  boundaries — all reproduced + tested.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum DataTableResizerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DataTableResizer"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<DataTableResizer>` is anonymous: it builds its accessible label inline (`label ?? \`Resize column
/// ${columnKey}\``) and exposes the width numerically through `aria-valuenow`, calling no `t()` of its own.
/// The only strings this surface owns are therefore the native VoiceOver additions (the label, the spoken
/// width value, and the gesture hint). Kept as a plain closure so the pure core has no dependency on a
/// bundle: the production app passes the P1/S10 facade, while tests pass an identity-fallback resolver.
public typealias DataTableResizerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - DataTableResizerInput (web props, closure-free)

/// The component's props — the native peer of `DataTableResizerProps`, minus the `onResize` / `onResizeEnd`
/// closures (held by the view + the state-holder). A value type so the view, the state-holder, and the pure
/// projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply when the
/// controlling page rebinds a fresh `width` mid-drag (the web `width` prop flows back continuously).
public struct DataTableResizerInput: Sendable, Equatable {
    /// The column key used for the accessible label (web `columnKey`).
    public let columnKey: String
    /// The current width in points (web `width`) — the controlled value the page owns; the handle never
    /// stores it locally.
    public let width: Double
    /// The minimum allowed width when resizing (web `minWidth`, default `60`).
    public let minWidth: Double
    /// The maximum allowed width when resizing (web `maxWidth`, default `800`).
    public let maxWidth: Double
    /// An optional accessible-label override (web `label`); when `nil` the surface builds "Resize column
    /// {columnKey}".
    public let label: String?

    public init(
        columnKey: String,
        width: Double,
        minWidth: Double = 60,
        maxWidth: Double = 800,
        label: String? = nil
    ) {
        self.columnKey = columnKey
        self.width = width
        self.minWidth = minWidth
        self.maxWidth = maxWidth
        self.label = label
    }
}

// MARK: - DataTableResizerProjection (view-ready)

/// The resolved, view-ready handle — everything the SwiftUI body needs as a pure function of the props +
/// the transient interaction flags (no derivation in the view). `width` is the clamped current width (web
/// `aria-valuenow`); `minWidth` / `maxWidth` are the bounds (web `aria-valuemin` / `aria-valuemax`);
/// `fillOpacity` is the resolved handle tint (web `opacity-0` → `hover:opacity-100 bg-cyan-400/40` →
/// `focus`/`dragging:bg-cyan-400/60`); `isActive` is whether the handle is currently highlighted.
public struct DataTableResizerProjection: Sendable, Equatable {
    /// The clamped current width in points (web `aria-valuenow`).
    public let width: Double
    /// The minimum allowed width (web `aria-valuemin`).
    public let minWidth: Double
    /// The maximum allowed width (web `aria-valuemax`).
    public let maxWidth: Double
    /// The resolved handle tint opacity for the current interaction (web resizer `opacity` / `bg-cyan`).
    public let fillOpacity: Double
    /// Whether the handle is highlighted (hover, focus, or drag) — drives the active-vs-resting visuals.
    public let isActive: Bool

    public init(width: Double, minWidth: Double, maxWidth: Double, fillOpacity: Double, isActive: Bool) {
        self.width = width
        self.minWidth = minWidth
        self.maxWidth = maxWidth
        self.fillOpacity = fillOpacity
        self.isActive = isActive
    }
}

// MARK: - DataTableResizerProjector (web render body + interaction math)

/// The pure projection from the props + the transient interaction flags to the view-ready model — the
/// surface's data adapter in the "state → projection" sense the acceptance calls for: it takes the props a
/// page already holds (no fetch, no clock) plus the hover / focus / drag flags and derives the rendered
/// handle, while also owning the resize math (the verbatim port of the web `clamp`, the drag-delta width,
/// and the keyboard splitter steps). Unit tested across the clamp boundaries, the rounding, the drag delta,
/// the arrow / Home / End steps, the fill opacity, and the interpolated copy.
public enum DataTableResizerProjector {
    /// The arrow-key resize increment in points — the verbatim web `ArrowLeft`/`ArrowRight` step of `8`.
    public static let step: Double = 8
    /// The `Home`-key reset width in points — the verbatim web `clamp(80)` reset target.
    public static let homeWidth: Double = 80

    /// The resting handle opacity — invisible until hover/focus (web `opacity-0`).
    public static let restingOpacity: Double = 0
    /// The hover handle opacity — the web `hover:opacity-100 hover:bg-cyan-400/40` net tint.
    public static let hoverOpacity: Double = 0.4
    /// The focus / drag handle opacity — the web `focus-visible:bg-cyan-400/60` and dragging
    /// `bg-cyan-400/60` net tint.
    public static let activeOpacity: Double = 0.6

    // MARK: Resize math (web `clamp` + drag delta + keyboard steps)

    /// Clamps a candidate width to the allowed range, rounding to a whole point — the verbatim port of the
    /// web `clamp = (n) => Math.max(minWidth, Math.min(maxWidth, Math.round(n)))`. Tolerates an inverted
    /// range (min > max) by letting the `max(minWidth, …)` win, matching the JS `Math.max`/`Math.min`
    /// composition.
    public static func clamp(_ value: Double, minWidth: Double, maxWidth: Double) -> Double {
        max(minWidth, min(maxWidth, value.rounded()))
    }

    /// The width during a drag — the verbatim port of the web `onResize(clamp(startWidth + delta))`, where
    /// `delta` is the pointer translation since the gesture began.
    public static func resizing(
        startWidth: Double,
        translation: Double,
        minWidth: Double,
        maxWidth: Double
    ) -> Double {
        clamp(startWidth + translation, minWidth: minWidth, maxWidth: maxWidth)
    }

    /// The width after a keyboard / VoiceOver step — the verbatim port of the web `clamp(width ± 8)` for
    /// `ArrowLeft` / `ArrowRight` (and the increment / decrement of the accessible adjustable action).
    public static func adjusted(
        width: Double,
        by delta: Double,
        minWidth: Double,
        maxWidth: Double
    ) -> Double {
        clamp(width + delta, minWidth: minWidth, maxWidth: maxWidth)
    }

    // MARK: Handle tint (web resizer opacity / cyan tint)

    /// The handle tint opacity for the current interaction — the verbatim composition of the web resizer
    /// classes: resting is invisible (`opacity-0`); a drag or keyboard focus shows the strong tint
    /// (`bg-cyan-400/60`); a plain hover shows the lighter tint (`bg-cyan-400/40`). Drag and focus win over
    /// hover, exactly as the web `dragging && 'bg-cyan-400/60'` overrides the `hover:` class.
    public static func handleFillOpacity(isDragging: Bool, isFocused: Bool, isHovering: Bool) -> Double {
        if isDragging || isFocused { return activeOpacity }
        if isHovering { return hoverOpacity }
        return restingOpacity
    }

    // MARK: Projection

    /// Resolves the whole handle from the props + the interaction flags — the native peer of the web
    /// component's render decision. The width is clamped so the projection always reports a legal value
    /// (web `aria-valuenow` never exceeds its min/max).
    public static func resolve(
        _ input: DataTableResizerInput,
        isDragging: Bool,
        isFocused: Bool,
        isHovering: Bool
    ) -> DataTableResizerProjection {
        DataTableResizerProjection(
            width: clamp(input.width, minWidth: input.minWidth, maxWidth: input.maxWidth),
            minWidth: input.minWidth,
            maxWidth: input.maxWidth,
            fillOpacity: handleFillOpacity(
                isDragging: isDragging,
                isFocused: isFocused,
                isHovering: isHovering
            ),
            isActive: isDragging || isFocused || isHovering
        )
    }

    // MARK: Interpolated copy (web i18next `{{token}}`)

    /// Replaces `{{token}}` markers in a resolved template with the supplied values — the native port of
    /// i18next interpolation, so the per-surface strings keep a translator-friendly `{{column}}` /
    /// `{{width}}` shape.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }

    /// The accessible label — the verbatim port of the web `label ?? \`Resize column ${columnKey}\``: a
    /// caller override wins, otherwise the column key is interpolated into the resolved template.
    public static func accessibilityLabel(
        columnKey: String,
        override: String?,
        template: String
    ) -> String {
        if let override, !override.isEmpty { return override }
        return interpolate(template, ["column": columnKey])
    }

    /// The spoken width value — the native peer of the web `aria-valuenow` (the raw whole-point width
    /// interpolated into the resolved "{{width}} points" template, no grouping separator).
    public static func accessibilityValue(width: Double, template: String) -> String {
        interpolate(template, ["width": String(Int(width.rounded()))])
    }
}
