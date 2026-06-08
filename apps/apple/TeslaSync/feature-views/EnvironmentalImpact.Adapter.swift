//
//  EnvironmentalImpact.Adapter.swift
//  TeslaSync — P4 feature view · 0112 · EnvironmentalImpact (Apple)
//
//  The pure, testable projection core for the EnvironmentalImpact surface: the
//  cache-then-network `coreStats → state` decision (web `coreStats ? … : noData`),
//  the locale-aware number formatting (web `fmtNumber`), the primary + secondary
//  stat tiles, the rich description sentence (web interpolated `<span>` figures),
//  the live freshness chip, and the VoiceOver summaries. No SwiftUI and no I/O —
//  every branch the web source carries is decided here so the XCTest suite can
//  cover it without a rendering host (the same approach the sibling feature views
//  use).
//

import Foundation

// MARK: - Localizer (P1/S10 facade injection)

/// A thin localization seam so the pure projections stay testable: production
/// passes the `EnvironmentalImpactStrings` facade (real catalog + English
/// fallback), tests pass `echo` (returns the fallback / formats it directly).
public struct EnvironmentalImpactLocalizer: Sendable {
    public let string: @Sendable (String, String) -> String
    public let format: @Sendable (String, String, String) -> String

    public init(
        string: @escaping @Sendable (String, String) -> String,
        format: @escaping @Sendable (String, String, String) -> String
    ) {
        self.string = string
        self.format = format
    }

    /// Production localizer backed by the surface's `.strings` table.
    public static let bundle = EnvironmentalImpactLocalizer(
        string: EnvironmentalImpactStrings.string,
        format: EnvironmentalImpactStrings.format
    )

    /// Bundle-free localizer for previews/tests: yields the English fallback.
    public static let echo = EnvironmentalImpactLocalizer(
        string: { _, fallback in fallback },
        format: { _, fallbackFormat, argument in String(format: fallbackFormat, argument) }
    )
}

// MARK: - Number formatting (web `fmtNumber(value, decimals)`)

/// Locale-aware fixed-precision number formatting — the port of the web
/// `fmtNumber`, including its `safeNumber` guard (non-finite inputs render as 0
/// so `NaN` / `±∞` never reach the UI).
public enum EnvironmentalImpactFormat {
    public static func number(
        _ value: Double,
        decimals: Int,
        locale: Locale = .current
    ) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(decimals)f", safe)
    }
}

// MARK: - Load phase (cache-then-network projection input)

/// The lifecycle phase of the cost-analysis aggregate, the value-typed mirror of
/// the shared `LoadableState` cases the parent holds (P1/S8). It feeds the
/// `resolve` projection so the cached-then-network behaviour is unit-testable
/// without importing the KMP `Shared` framework.
public enum EnvironmentalImpactLoadPhase: Equatable, Sendable {
    case loading
    case loaded
    case empty
    case failed(message: String?)
}

/// The settled render inputs for the card: which `state` to paint and the
/// freshness `connection` chip to show.
public struct EnvironmentalImpactResolution: Equatable, Sendable {
    public let state: EnvironmentalImpactState
    public let connection: EnvironmentalImpactConnection

    public init(state: EnvironmentalImpactState, connection: EnvironmentalImpactConnection) {
        self.state = state
        self.connection = connection
    }
}

// MARK: - Projection (web `coreStats ? loaded : noData` + cache-then-network)

/// The pure projection core — decides the card state and freshness from the
/// aggregate, exactly like the web conditional plus the shared cache-then-network
/// contract (a cached value stays on screen through a refresh or a failure).
public enum EnvironmentalImpactProjection {
    /// The web conditional in isolation: a value renders `loaded`, its absence
    /// renders the `empty` "No data" branch.
    public static func state(from coreStats: EnvironmentalImpactData?) -> EnvironmentalImpactState {
        guard let coreStats else { return .empty }
        return .loaded(coreStats)
    }

    /// Freshness chip selection from the live-connection flags.
    public static func connection(stale: Bool, offline: Bool) -> EnvironmentalImpactConnection {
        if offline { return .offline }
        if stale { return .stale }
        return .live
    }

    /// Full cache-then-network resolution (P1/S8 `LoadableState` semantics):
    /// - `loading` keeps any `cached` figures on screen, else shows the skeleton.
    /// - `loaded` paints the value, or falls back to `empty` when it is absent.
    /// - `empty` is the web "No data" branch.
    /// - `failed` keeps any `cached` figures on screen, else shows the error.
    public static func resolve(
        value: EnvironmentalImpactData?,
        phase: EnvironmentalImpactLoadPhase,
        stale: Bool = false,
        offline: Bool = false
    ) -> EnvironmentalImpactResolution {
        let connection = connection(stale: stale, offline: offline)
        let state: EnvironmentalImpactState = switch phase {
        case .loading:
            value.map(EnvironmentalImpactState.loaded) ?? .loading
        case .loaded:
            value.map(EnvironmentalImpactState.loaded) ?? .empty
        case .empty:
            .empty
        case let .failed(message):
            value.map(EnvironmentalImpactState.loaded) ?? .error(message: message)
        }
        return EnvironmentalImpactResolution(state: state, connection: connection)
    }
}

// MARK: - Stat tiles (web primary 2-col + secondary 3-col figures)

/// One formatted figure tile — its identity, the pre-formatted display value, its
/// label key + English fallback, and the raw value (for tests + accessibility).
public struct EnvironmentalStat: Identifiable, Equatable, Sendable {
    public let id: String
    public let value: String
    public let labelKey: String
    public let labelFallback: String
    public let rawValue: Double

    public init(id: String, value: String, labelKey: String, labelFallback: String, rawValue: Double) {
        self.id = id
        self.value = value
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.rawValue = rawValue
    }
}

public extension EnvironmentalImpactProjection {
    /// Web top grid: CO₂ saved (1 dp) + tree-years equivalent (1 dp).
    static func primaryStats(
        _ data: EnvironmentalImpactData,
        locale: Locale = .current
    ) -> [EnvironmentalStat] {
        [
            EnvironmentalStat(
                id: "co2SavedKg",
                value: EnvironmentalImpactFormat.number(data.co2SavedKg, decimals: 1, locale: locale),
                labelKey: "costAnalysis.environment.kgCo2",
                labelFallback: "kg CO₂ saved",
                rawValue: data.co2SavedKg
            ),
            EnvironmentalStat(
                id: "treeEquiv",
                value: EnvironmentalImpactFormat.number(data.treeEquiv, decimals: 1, locale: locale),
                labelKey: "costAnalysis.environment.treeEquiv",
                labelFallback: "tree-years equivalent",
                rawValue: data.treeEquiv
            )
        ]
    }

    /// Web bottom grid: gallons avoided (1 dp), metric tons CO₂ (2 dp), $ saved
    /// total (0 dp).
    static func secondaryStats(
        _ data: EnvironmentalImpactData,
        locale: Locale = .current
    ) -> [EnvironmentalStat] {
        [
            EnvironmentalStat(
                id: "gallonsEquiv",
                value: EnvironmentalImpactFormat.number(data.gallonsEquiv, decimals: 1, locale: locale),
                labelKey: "costAnalysis.environment.gallons",
                labelFallback: "gallons avoided",
                rawValue: data.gallonsEquiv
            ),
            EnvironmentalStat(
                id: "metricTons",
                value: EnvironmentalImpactFormat.number(data.metricTonsCo2, decimals: 2, locale: locale),
                labelKey: "costAnalysis.environment.metricTons",
                labelFallback: "metric tons CO₂",
                rawValue: data.metricTonsCo2
            ),
            EnvironmentalStat(
                id: "savings",
                value: EnvironmentalImpactFormat.number(data.savings, decimals: 0, locale: locale),
                labelKey: "costAnalysis.environment.dollarsSaved",
                labelFallback: "$ saved total",
                rawValue: data.savings
            )
        ]
    }
}

// MARK: - Description sentence (web interpolated `<p>` with bold figures)

/// The resolved description copy — the port of the web sentence that interleaves
/// localized prose with two bold-green figures (the rounded CO₂ kilograms and the
/// tree-years). The segments drive the SwiftUI rich `Text`; `accessibilityLabel`
/// is the whole sentence read as one phrase for VoiceOver.
public struct EnvironmentalImpactDescription: Equatable, Sendable {
    /// Leading prose ending before the first bold figure.
    public let lead: String
    /// Bold figure #1 — "<n> kg" of CO₂.
    public let co2Highlight: String
    /// Prose between the two bold figures.
    public let middle: String
    /// Bold figure #2 — the tree-years count.
    public let treeHighlight: String
    /// Trailing prose after the second bold figure.
    public let trailing: String
    /// The full sentence, for the combined VoiceOver label.
    public let accessibilityLabel: String

    public static func build(
        _ data: EnvironmentalImpactData,
        locale: Locale = .current,
        localize: EnvironmentalImpactLocalizer
    ) -> EnvironmentalImpactDescription {
        let lead = localize.string(
            "costAnalysis.environment.desc",
            "By driving electric instead of a gas car, you have avoided the equivalent of"
        )
        let co2Highlight = localize.format(
            "costAnalysis.environment.kgValue",
            "%@ kg",
            EnvironmentalImpactFormat.number(data.co2SavedKg, decimals: 0, locale: locale)
        )
        let ofCo2 = localize.string("costAnalysis.environment.ofCo2", "of CO₂ emissions.")
        let treeNote = localize.string("costAnalysis.environment.treeNote", "That's the same as")
        let treeHighlight = EnvironmentalImpactFormat.number(data.treeEquiv, decimals: 1, locale: locale)
        let trailing = localize.string(
            "costAnalysis.environment.treesAbsorbing",
            "trees absorbing carbon for a full year."
        )
        let middle = "\(ofCo2) \(treeNote)"
        let accessibility = "\(lead) \(co2Highlight) \(middle) \(treeHighlight) \(trailing)"
        return EnvironmentalImpactDescription(
            lead: lead,
            co2Highlight: co2Highlight,
            middle: middle,
            treeHighlight: treeHighlight,
            trailing: trailing,
            accessibilityLabel: accessibility
        )
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// The freshness chip projection — `live` shows no chip (figures are fresh),
/// `stale`/`offline` surface a static chip so the card never implies a freshness
/// it cannot prove while keeping the cached figures visible.
public enum EnvironmentalFreshnessChip: Equatable, Sendable {
    case stale
    case offline

    public static func project(_ connection: EnvironmentalImpactConnection) -> EnvironmentalFreshnessChip? {
        switch connection {
        case .live: nil
        case .stale: .stale
        case .offline: .offline
        }
    }

    public var labelKey: String {
        switch self {
        case .stale: "costAnalysis.environment.freshness.stale"
        case .offline: "costAnalysis.environment.freshness.offline"
        }
    }

    public var labelFallback: String {
        switch self {
        case .stale: "Stale"
        case .offline: "Offline"
        }
    }

    public var systemImage: String {
        switch self {
        case .stale: "clock.arrow.circlepath"
        case .offline: "wifi.slash"
        }
    }

    public var tone: TSTone {
        switch self {
        case .stale: .warning
        case .offline: .neutral
        }
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Pure VoiceOver string builders so the card announces as coherent elements and
/// the tests can assert label presence without a rendering host.
public enum EnvironmentalImpactAccessibility {
    /// The header summary: the title plus, when present, the freshness chip.
    public static func headerLabel(
        chip: EnvironmentalFreshnessChip?,
        localize: EnvironmentalImpactLocalizer
    ) -> String {
        let title = localize.string("costAnalysis.environment.title", "Environmental Impact")
        guard let chip else { return title }
        return "\(title), \(localize.string(chip.labelKey, chip.labelFallback))"
    }

    /// A stat tile read as one phrase: "<value> <label>".
    public static func statLabel(
        _ stat: EnvironmentalStat,
        localize: EnvironmentalImpactLocalizer
    ) -> String {
        "\(stat.value) \(localize.string(stat.labelKey, stat.labelFallback))"
    }
}
