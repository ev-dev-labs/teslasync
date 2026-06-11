//
//  TimeMarker.Projection.swift
//  TeslaSync — P4 shared surface · 0074 · TimeMarker (Apple)
//
//  The pure projection from the resolved alert context (or an explicit x value) to the view-ready
//  marker model the chart bridge draws — the native port of the web `TimeMarker` render body. The
//  web component maps `(x, severity, label, …)` to either `null` (when `x` is absent) or a single
//  `<ReferenceLine>`; this projection collapses the same decision into a ``TimeMarkerResolved`` whose
//  `isVisible` flag is the `x == null` guard and whose `severity` has already been defaulted to
//  `.warn` (web `severity ?? 'warn'`). The view (and the `@ChartContentBuilder`) is a pure function
//  of this value; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``resolve(context:severity:label:strokeWidth:dashPattern:)`` takes the cached
//  ``TimeMarkerAlertContext`` snapshot (what `useAlertContext` derived from the URL) plus the alert's
//  severity + the localized label and derives the marker, deriving the x value from the context's
//  parsed timestamp exactly as a web page maps the alert moment onto its chart's x-axis.
//

import Foundation

// MARK: - TimeMarkerResolved (web `TimeMarker` render output)

/// The resolved, view-ready marker — the native bundle of everything the web `TimeMarker` spreads
/// onto its `<ReferenceLine>`, plus the `x == null` decision baked into ``isVisible``. When `value`
/// is `nil` the chart draws no line (web `return null`); otherwise it draws one severity-colored,
/// labeled vertical rule at `value`.
public struct TimeMarkerResolved: Sendable, Equatable {
    /// The x position of the marker (web `x`), or `nil` when nothing should be drawn.
    public let value: TimeMarkerValue?
    /// The (already-normalized, already-defaulted) severity driving the color (web `severity`).
    public let severity: MarkerSeverity
    /// The label rendered at the top of the line (web `label`, default "Alert" supplied by the
    /// caller through the i18n facade).
    public let label: String
    /// The line width (web `strokeWidth`, default 2).
    public let strokeWidth: Double
    /// The dash pattern, or `nil` for a solid line (web `strokeDasharray`, default solid).
    public let dashPattern: [Double]?

    public init(
        value: TimeMarkerValue?,
        severity: MarkerSeverity,
        label: String,
        strokeWidth: Double,
        dashPattern: [Double]?
    ) {
        self.value = value
        self.severity = severity
        self.label = label
        self.strokeWidth = strokeWidth
        self.dashPattern = dashPattern
    }

    /// `true` when a reference line should be drawn (web `x != null && x !== ''`).
    public var isVisible: Bool {
        value != nil
    }

    /// The "draw nothing" projection — the native peer of the web `return null`. A chart embeds the
    /// marker unconditionally and this branch simply contributes no `ChartContent`.
    public static let hidden = TimeMarkerResolved(
        value: nil,
        severity: .markerDefault,
        label: "",
        strokeWidth: 2,
        dashPattern: nil
    )
}

// MARK: - Projection (context / value → resolved)

/// Pure projection to the view-ready marker. Two entry points mirror the two ways the web wires the
/// component: ``resolve(value:severity:label:strokeWidth:dashPattern:)`` is the direct
/// `<TimeMarker x=… />` call (the caller already mapped the alert moment onto the chart's x value),
/// and ``resolve(context:severity:label:strokeWidth:dashPattern:)`` is the page-level integration
/// that derives that x from the ``TimeMarkerAlertContext`` `useAlertContext` produced.
public enum TimeMarkerProjection {
    /// Direct projection from an explicit x value — the parity of `<TimeMarker x severity label>`.
    /// `severity` defaults to `.warn` (web `severity ?? 'warn'`); `value` of `nil` yields
    /// ``TimeMarkerResolved/hidden`` (web `x == null` → `return null`).
    public static func resolve(
        value: TimeMarkerValue?,
        severity: MarkerSeverity = .markerDefault,
        label: String,
        strokeWidth: Double = 2,
        dashPattern: [Double]? = nil
    ) -> TimeMarkerResolved {
        guard let value else { return .hidden }
        return TimeMarkerResolved(
            value: value,
            severity: severity,
            label: label,
            strokeWidth: strokeWidth,
            dashPattern: dashPattern
        )
    }

    /// Page-level projection from the cached alert context — derives the marker x from the context's
    /// parsed timestamp (web: a page reads `useAlertContext().timestamp` and feeds the matching x to
    /// `<TimeMarker>`). When the context carries no parseable timestamp the result is
    /// ``TimeMarkerResolved/hidden`` even if other params are present, faithfully mirroring the web
    /// `x == null` guard.
    public static func resolve(
        context: TimeMarkerAlertContext,
        severity: MarkerSeverity = .markerDefault,
        label: String,
        strokeWidth: Double = 2,
        dashPattern: [Double]? = nil
    ) -> TimeMarkerResolved {
        resolve(
            value: context.markerValue,
            severity: severity,
            label: label,
            strokeWidth: strokeWidth,
            dashPattern: dashPattern
        )
    }
}
