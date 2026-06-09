//
//  SlideRenderer.Adapter.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  Pure (Foundation-only) projection value types (the SlideHero body cases + SlideProjection) and the VoiceOver
//  accessibility summaries. Gradient/format live in SlideRenderer.Gradient.swift; the projector in
//  SlideRenderer.Projector.swift.
//

import Foundation

// MARK: - Projection (web slide bodies the renderer composes)

/// One charging-mix share — the projection of a web `ChargingBreakdownSlide` legend row
/// (Supercharger / DC Fast / AC-Other). Only positive shares are kept, mirroring the web
/// `.filter(d => d.value > 0)`.
public struct ChargingShare: Equatable, Sendable, Identifiable {
    public let label: String
    public let percentText: String
    public let fraction: Double

    public var id: String {
        label
    }

    public init(label: String, percentText: String, fraction: Double) {
        self.label = label
        self.percentText = percentText
        self.fraction = fraction
    }
}

/// The drive-highlight body — the slice the web `SlideRenderer` arm owns (label + emoji + which drive)
/// projected to display strings (SI km + Wh/km). When the recap has no drive for the variant, the
/// renderer shows the localized `noDataText`, mirroring the web slide's `if (!drive)` branch.
public struct DriveHighlightHero: Equatable, Sendable {
    public let emoji: String
    public let label: String
    public let hasDrive: Bool
    public let noDataText: String
    public let startAddress: String
    public let endAddress: String
    public let distanceText: String
    public let distanceUnit: String
    public let durationText: String
    public let durationLabel: String
    public let efficiencyText: String
    public let efficiencyUnit: String
    public let date: String
}

/// The charging-breakdown body — total sessions + average plug-in SOC caption + the positive shares.
public struct ChargingBreakdownHero: Equatable, Sendable {
    public let emoji: String
    public let sessionsValue: String
    public let sessionsLabel: String
    public let socCaption: String
    public let shares: [ChargingShare]
}

/// The render-ready body for one slide. A small enum (not a bag of optionals) so each arm of the web
/// `switch` maps to exactly one case and the view + tests stay exhaustive. `.none` is the parity of the
/// web `default: return null` (the gradient renders with no body).
public enum SlideHero: Equatable, Sendable {
    /// A centered emoji + headline value + unit + supporting caption (title / stat-hero / stat-chart /
    /// savings / environment / patterns / summary).
    case stat(emoji: String, title: String, value: String?, unit: String?, caption: String?)
    /// The drive-highlight body (the slice the renderer owns).
    case driveHighlight(DriveHighlightHero)
    /// The fun-facts grid.
    case comparisons(emoji: String, title: String, items: [YearReviewRecapComparison])
    /// The charging-mix body.
    case chargingBreakdown(ChargingBreakdownHero)
    /// No body — the gradient only (web `default:`).
    case none
}

/// The fully-projected slide: its position (for the keyed transition + telemetry), kind, gradient
/// stops, the composed body, and a flattened VoiceOver summary. Computed once per snapshot/selection by
/// the model.
public struct SlideProjection: Equatable, Sendable {
    public let index: Int
    public let kind: SlideKind
    public let gradient: [SlideGradientStop]
    public let hero: SlideHero
    public let accessibilityLabel: String

    public init(
        index: Int,
        kind: SlideKind,
        gradient: [SlideGradientStop],
        hero: SlideHero,
        accessibilityLabel: String
    ) {
        self.index = index
        self.kind = kind
        self.gradient = gradient
        self.hero = hero
        self.accessibilityLabel = accessibilityLabel
    }
}

// Pure projector: `SlideDefinitionInput` + `YearReviewRecap` + locale → `SlideProjection`. Reproduces
// the web `SlideRenderer` dispatch (including the `drive-highlight` selection it owns) and composes a
// faithful, data-bound default body for each kind. Localized strings resolve through the injected
// `localize` closure (bundle-backed in the app, echoing in tests).

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver summary spoken for a slide body. Pure + public so the a11y label content can be
/// unit-tested without rendering the view. Labels resolve through the injected localizer.
public enum SlideRendererAccessibility {
    public static func summary(for hero: SlideHero, localize: (String, String) -> String) -> String {
        switch hero {
        case let .stat(_, title, value, unit, caption):
            return [value, unit, title, caption]
                .compactMap(\.self)
                .filter { !$0.isEmpty }
                .joined(separator: ", ")

        case let .driveHighlight(drive):
            guard drive.hasDrive else {
                return [drive.label, drive.noDataText].joined(separator: ", ")
            }
            let route = "\(drive.startAddress) \(localize("slideRenderer.a11y.to", "to")) \(drive.endAddress)"
            return [
                drive.label,
                route,
                "\(drive.distanceText) \(drive.distanceUnit)",
                "\(drive.durationText) \(drive.durationLabel)"
            ].joined(separator: ", ")

        case let .comparisons(_, title, items):
            let facts = items.map { "\($0.label) \($0.value)" }
            return ([title] + facts).joined(separator: ", ")

        case let .chargingBreakdown(charging):
            let mix = charging.shares.map { "\($0.label) \($0.percentText)" }
            return ([
                "\(charging.sessionsValue) \(charging.sessionsLabel)",
                charging.socCaption
            ] + mix).joined(separator: ", ")

        case .none:
            return ""
        }
    }
}
