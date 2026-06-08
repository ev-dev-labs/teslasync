//
//  XRayHeader.Adapter.swift
//  TeslaSync — P4 feature view · 0035 · XRayHeader (Apple)
//
//  The testable projection core for the Ingest X-Ray header strip: the cached
//  `IngestXRayResponse` summary (web `data`) + the operator-selected window (web
//  `windowSel`) → the three view-ready stat tiles the strip renders. Pure +
//  Foundation-only (no SwiftUI, no bundle) so the projection, the integer
//  formatter, the window-label mapping, and the VoiceOver summary unit-test
//  without a store or a rendered view.
//
//  Parity source: web/src/features/admin/components/ingest-xray/XRayHeader.tsx —
//  the three `StatCard`s (Total samples / Distinct fields / Window) inside a
//  `Grid cols={{ default: 1, sm: 3 }}`, valued by `fmtInt(data?.x ?? 0)` and the
//  `WINDOW_LABEL[windowSel]` echo.
//

import Foundation

// MARK: - Observation window (web `IngestXRayWindow` + `WINDOW_LABEL`)

/// The operator-selected observation window — the native port of the web
/// `IngestXRayWindow` union (`'5m' | '15m' | '1h' | '6h' | '24h'`). The raw value
/// is the exact server-accepted wire token; `labelKey`/`labelFallback` carry the
/// web `WINDOW_LABEL` echo so the Window tile reads like a self-explanatory
/// summary.
public enum IngestXRayWindow: String, Sendable, Equatable, CaseIterable {
    case m5 = "5m"
    case m15 = "15m"
    case h1 = "1h"
    case h6 = "6h"
    case h24 = "24h"

    /// The server-accepted wire token (web union literal).
    public var wire: String {
        rawValue
    }

    /// The i18n key for the window label (web ``t(`admin.xray.windowLabel.${windowSel}`)``).
    public var labelKey: String {
        "admin.xray.windowLabel.\(rawValue)"
    }

    /// The web `WINDOW_LABEL` English fallback for the window.
    public var labelFallback: String {
        switch self {
        case .m5: "5 minutes"
        case .m15: "15 minutes"
        case .h1: "1 hour"
        case .h6: "6 hours"
        case .h24: "24 hours"
        }
    }

    /// Resolves a wire token into a window, defaulting to 15 minutes (the web
    /// page's initial selection) for any unrecognized value so the strip never
    /// renders a blank window tile.
    public static func from(wire: String) -> IngestXRayWindow {
        IngestXRayWindow(rawValue: wire) ?? .m15
    }
}

// MARK: - Cached summary (web `IngestXRayResponse`)

/// The cached X-Ray summary the header strip reads — the relevant slice of the
/// web `IngestXRayResponse`. Optional numerics mirror the web `?? 0`
/// null-coalescing applied at the call site (`fmtInt(data?.total_samples ?? 0)`).
public struct IngestXRaySummary: Sendable, Equatable {
    public var totalSamples: Int?
    public var uniqueFields: Int?
    public var generatedAt: Date?

    public init(
        totalSamples: Int? = nil,
        uniqueFields: Int? = nil,
        generatedAt: Date? = nil
    ) {
        self.totalSamples = totalSamples
        self.uniqueFields = uniqueFields
        self.generatedAt = generatedAt
    }
}

// MARK: - Projected tile (web `StatCard` inputs)

/// One projected stat tile the strip renders — the native port of a single web
/// `StatCard`. Carries the SF Symbol, the i18n key + web English fallback for the
/// label and sublabel, and the pre-formatted value (locale-grouped integer for
/// the numeric tiles, the localized window label for the window tile).
public struct XRayStat: Identifiable, Equatable, Sendable {
    /// The three tiles the web header renders, in order.
    public enum Kind: String, Sendable, Equatable, CaseIterable {
        case samples
        case fields
        case window
    }

    public let kind: Kind
    public let iconSystemName: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let sublabelKey: String
    public let sublabelFallback: String

    public var id: Kind {
        kind
    }

    /// Whether the tile shows a streamed numeric value (skeletoned on the initial
    /// load) versus the always-known window echo (never skeletoned).
    public var isNumeric: Bool {
        kind != .window
    }

    public init(
        kind: Kind,
        iconSystemName: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        sublabelKey: String,
        sublabelFallback: String
    ) {
        self.kind = kind
        self.iconSystemName = iconSystemName
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.sublabelKey = sublabelKey
        self.sublabelFallback = sublabelFallback
    }
}

// MARK: - Projection (web header `Grid` of three `StatCard`s)

/// Builds the three-tile projection the strip renders, reproducing the web
/// `XRayHeader`: `fmtInt(data?.total_samples ?? 0)` for samples,
/// `fmtInt(data?.unique_fields ?? 0)` for fields, and the `WINDOW_LABEL[windowSel]`
/// echo for the window. Pure + bundle-free: the window label is resolved through
/// the injected `localize`, so the projection unit-tests without `.main`.
public enum XRayHeaderProjection {
    public static func build(
        summary: IngestXRaySummary?,
        window: IngestXRayWindow,
        localize: (String, String) -> String
    ) -> [XRayStat] {
        [
            XRayStat(
                kind: .samples,
                iconSystemName: "waveform.path.ecg",
                labelKey: "admin.xray.stats.samples",
                labelFallback: "Total samples",
                value: fmtInt(summary?.totalSamples ?? 0),
                sublabelKey: "admin.xray.stats.samplesSub",
                sublabelFallback: "within selected window"
            ),
            XRayStat(
                kind: .fields,
                iconSystemName: "square.stack.3d.up",
                labelKey: "admin.xray.stats.fields",
                labelFallback: "Distinct fields",
                value: fmtInt(summary?.uniqueFields ?? 0),
                sublabelKey: "admin.xray.stats.fieldsSub",
                sublabelFallback: "unique signal names"
            ),
            XRayStat(
                kind: .window,
                iconSystemName: "clock",
                labelKey: "admin.xray.stats.window",
                labelFallback: "Window",
                value: localize(window.labelKey, window.labelFallback),
                sublabelKey: "admin.xray.stats.windowSub",
                sublabelFallback: "observation horizon"
            )
        ]
    }

    /// Locale-aware grouped integer — the native port of the web `fmtInt`
    /// (`Intl.NumberFormat` with zero fraction digits).
    public static func fmtInt(_ value: Int) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver sentence for one stat tile. Pure + public so the spoken
/// content is unit-testable without rendering the view: "<label>, <value>,
/// <sublabel>".
public enum XRayHeaderAccessibility {
    public static func statSummary(
        stat: XRayStat,
        localize: (String, String) -> String
    ) -> String {
        let label = localize(stat.labelKey, stat.labelFallback)
        let sublabel = localize(stat.sublabelKey, stat.sublabelFallback)
        return "\(label), \(stat.value), \(sublabel)"
    }
}
