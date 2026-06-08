//
//  FleetStatsBar.Projection.swift
//  TeslaSync — P4 feature view · 0123 · FleetStatsBar (Apple)
//
//  The pure, dependency-free projection layer for the dashboard fleet stats bar — the
//  responsive column math (web `grid-cols-2 sm:3 md:4 lg:5`), the five-card projection
//  (web card wiring), the empty detection + phase resolution (the parent widget's
//  loading / empty / error lifecycle), the diagnostics slug, and the VoiceOver
//  summaries. Split out of FleetStatsBar.Adapter.swift to keep each file within the
//  swiftlint file-length budget; the data types + formatters live there, the logic
//  lives here. Foundation only — no store, no bundle, no rendered view.
//

import Foundation

// MARK: - Responsive layout (web `grid-cols-2 sm:3 md:4 lg:5`)

/// The responsive column math, ported from the web Tailwind grid so it is testable and
/// identical across iPhone / iPad / Mac widths. Tailwind breakpoints are CSS pixels:
/// `sm` = 640, `md` = 768, `lg` = 1024.
public enum FleetStatsLayout {
    public static let smBreakpoint: CGFloat = 640
    public static let mdBreakpoint: CGFloat = 768
    public static let lgBreakpoint: CGFloat = 1024

    /// Columns for an available width: 2 below `sm`, 3 below `md`, 4 below `lg`, 5 at
    /// or above `lg` (web `grid-cols-2` / `sm:grid-cols-3` / `md:grid-cols-4` /
    /// `lg:grid-cols-5`).
    public static func columnCount(forWidth width: CGFloat) -> Int {
        if width >= lgBreakpoint { return 5 }
        if width >= mdBreakpoint { return 4 }
        if width >= smBreakpoint { return 3 }
        return 2
    }
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the input snapshot to the five cards + the
/// render phase — the native port of the web component's card wiring plus the parent
/// widget's lifecycle envelope. Each card is built by a small helper so the public
/// `cards(from:locale:)` entry stays compact.
public enum FleetStatsProjection {
    /// Whether a resolved snapshot carries nothing to show — no vehicles, no analytics,
    /// no recent activity, no alerts. Distinguishes the friendly empty state from a row
    /// of zeros (prompt: "never a blank box").
    public static func isEmpty(_ input: FleetStatsInput) -> Bool {
        input.vehicleCount == 0
            && input.analytics == nil
            && input.recentDriveDistancesM.isEmpty
            && input.recentChargeEnergiesWh.isEmpty
            && input.unreadAlerts == 0
    }

    /// Resolves the render phase from the bound load status + whether the snapshot has
    /// anything to show.
    public static func resolvePhase(_ status: FleetStatsLoadStatus, isEmpty: Bool) -> FleetStatsPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            isEmpty ? .empty : .content
        }
    }

    /// Builds the five cards in the web order, applying the unit conversions, the
    /// `fmtNumber` formatting, and the per-card accent / caption / sparkline wiring.
    public static func cards(from input: FleetStatsInput, locale: Locale = .current) -> [FleetStatCard] {
        [
            sizeCard(input, locale: locale),
            distanceCard(input, locale: locale),
            energyCard(input, locale: locale),
            efficiencyCard(input, locale: locale),
            alertsCard(input, locale: locale)
        ]
    }

    // MARK: Per-card builders (web `<GlassPanel>` tiles)

    private static func sizeCard(_ input: FleetStatsInput, locale: Locale) -> FleetStatCard {
        FleetStatCard(
            id: "size",
            labelKey: "fleet.size",
            labelFallback: "Fleet Size",
            valueText: FleetStatsFormat.number(Double(input.vehicleCount), decimals: 0, locale: locale),
            accent: .neutral,
            caption: .online(input.onlineCount),
            sparkline: nil
        )
    }

    private static func distanceCard(_ input: FleetStatsInput, locale: Locale) -> FleetStatCard {
        let display = FleetUnits.distanceFromSI(input.analytics?.totalDistanceSI ?? 0, input.unit)
        return FleetStatCard(
            id: "distance",
            labelKey: "fleet.distance",
            labelFallback: "Distance (30d)",
            valueText: FleetStatsFormat.withUnit(display, decimals: 0, unit: input.unit.label, locale: locale),
            accent: .distance,
            caption: nil,
            sparkline: Array(input.recentDriveDistancesM.reversed())
        )
    }

    private static func energyCard(_ input: FleetStatsInput, locale: Locale) -> FleetStatCard {
        FleetStatCard(
            id: "energy",
            labelKey: "fleet.energy",
            labelFallback: "Energy (30d)",
            valueText: FleetStatsFormat.withUnit(
                input.analytics?.totalEnergyKwh ?? 0, decimals: 1, unit: FleetUnits.energyLabel, locale: locale
            ),
            accent: .energy,
            caption: nil,
            sparkline: Array(input.recentChargeEnergiesWh.reversed())
        )
    }

    private static func efficiencyCard(_ input: FleetStatsInput, locale: Locale) -> FleetStatCard {
        let display = FleetUnits.efficiencyFromWhKm(input.analytics?.avgEfficiencyWhKm ?? 0, input.unit)
        return FleetStatCard(
            id: "efficiency",
            labelKey: "fleet.efficiency",
            labelFallback: "Efficiency",
            valueText: FleetStatsFormat.withUnit(
                display, decimals: 0, unit: FleetUnits.efficiencyLabel(input.unit), locale: locale
            ),
            accent: .efficiency,
            caption: .localized(key: "fleet.average", fallback: "fleet average"),
            sparkline: nil
        )
    }

    private static func alertsCard(_ input: FleetStatsInput, locale: Locale) -> FleetStatCard {
        FleetStatCard(
            id: "alerts",
            labelKey: "fleet.alerts",
            labelFallback: "Alerts",
            valueText: FleetStatsFormat.number(Double(input.unreadAlerts), decimals: 0, locale: locale),
            accent: input.unreadAlerts > 0 ? .alert : .calm,
            caption: .localized(key: "fleet.unread", fallback: "unread"),
            sparkline: nil
        )
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum FleetStatsSurface {
    public static let slug = "FleetStatsBar"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle.
public enum FleetStatsAccessibility {
    /// One card's combined VoiceOver label ("{label}, {value}[, {detail}]").
    public static func cardLabel(label: String, value: String, detail: String?) -> String {
        if let detail, !detail.isEmpty {
            return "\(label), \(value), \(detail)"
        }
        return "\(label), \(value)"
    }

    /// The bar-level summary: title + each card's label + value.
    public static func barSummary(
        cards: [FleetStatCard],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("fleet.statsTitle", "Fleet statistics")
        guard !cards.isEmpty else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let parts = cards.map { "\(localize($0.labelKey, $0.labelFallback)) \($0.valueText)" }
        return "\(title): " + parts.joined(separator: ", ")
    }
}
