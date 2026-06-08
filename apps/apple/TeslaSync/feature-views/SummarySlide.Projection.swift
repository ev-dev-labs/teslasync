//
//  SummarySlide.Projection.swift
//  TeslaSync — P4 feature view · 0069 · SummarySlide (Apple)
//
//  The cached→projection adapter — a faithful port of the web source's component
//  body: the five `stats[]` rows (each with its Lucide-mapped icon, label, and
//  `AnimatedNumber` value), the distance conversion
//  (`convertDistanceFromSI(total_distance_km * 1000, unit)`), the conditional
//  `gas_savings > 0` savings line, the header, and the brand + screenshot captions
//  — plus the per-state presentation resolver. Pure value logic: no SwiftUI, no
//  networking, so every render branch is unit-testable.
//

import Foundation

// MARK: - Projection output value types

/// One headline stat row (web `stats.map(...)`): the icon, the label (the web
/// `t(key)` or the verbatim distance unit), and the pre-formatted value the
/// `AnimatedNumber` renders. Pure value type so row formatting is unit-tested.
public struct SummaryStat: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: SummaryStatKind
    public let iconSystemName: String
    public let label: String
    public let formattedValue: String

    public init(kind: SummaryStatKind, label: String, formattedValue: String) {
        id = kind.rawValue
        self.kind = kind
        iconSystemName = kind.iconSystemName
        self.label = label
        self.formattedValue = formattedValue
    }
}

/// The card header (web year / title / vehicle name + model block).
public struct SummaryHeader: Equatable, Sendable {
    public let yearText: String
    public let titleText: String
    public let vehicleName: String
    public let vehicleModel: String
}

/// The conditional savings line (web `data.gas_savings > 0 && …`).
public struct SummarySavings: Equatable, Sendable {
    public let amount: Int
    public let text: String
}

/// The fully-resolved render model for the loaded card (web's screenshot card).
public struct SummaryProjection: Equatable, Sendable {
    public let header: SummaryHeader
    public let stats: [SummaryStat]
    public let savings: SummarySavings?
    public let brandLine: String
    public let screenshotHint: String
}

// MARK: - Projection build (cached → projection)

public extension SummaryProjection {
    /// The shared em-dash for an empty header cell (null-safety floor).
    static var emDash: String {
        "—"
    }

    /// Builds the projection from the cached summary, reproducing the web body:
    /// the five ordered stats, the distance SI→display conversion, the conditional
    /// savings line, and the localized header + captions.
    static func make(
        from summary: YearReviewSummary,
        distanceUnit: DistanceDisplayUnit,
        locale: Locale = .current
    ) -> SummaryProjection {
        SummaryProjection(
            header: header(from: summary, locale: locale),
            stats: stats(from: summary, distanceUnit: distanceUnit, locale: locale),
            savings: savings(from: summary, locale: locale),
            brandLine: SummarySlideStrings.string("yearReview.brandLine", "TeslaSync • Year in Review"),
            screenshotHint: SummarySlideStrings.string(
                "yearReview.screenshot",
                "📸 Screenshot to share your year!"
            )
        )
    }

    private static func header(from summary: YearReviewSummary, locale _: Locale) -> SummaryHeader {
        SummaryHeader(
            yearText: String(summary.year),
            titleText: SummarySlideStrings.string("yearReview.title", "Year in Review"),
            vehicleName: nonEmpty(summary.vehicle.displayName),
            vehicleModel: nonEmpty(summary.vehicle.model)
        )
    }

    /// The five stats in the exact web order: drives, distance, energy, charges, CO₂.
    /// The distance value is `convertDistanceFromSI(total_distance_km * 1000, unit)`
    /// (web line: SI km → metre floor → display unit); its label is the unit itself.
    private static func stats(
        from summary: YearReviewSummary,
        distanceUnit: DistanceDisplayUnit,
        locale: Locale
    ) -> [SummaryStat] {
        let distanceMeters = summary.totalDistanceKm * 1000
        let distanceValue = SummaryUnitMath.convertDistanceFromSI(distanceMeters, to: distanceUnit)
        return [
            stat(
                .drives,
                label: localized("yearReview.totalDrives", "Drives"),
                value: Double(summary.totalDrives),
                locale: locale
            ),
            stat(.distance, label: distanceUnit.label, value: distanceValue, locale: locale),
            stat(
                .energy,
                label: localized("yearReview.energyKwh", "kWh"),
                value: summary.totalEnergyKwh,
                locale: locale
            ),
            stat(
                .charges,
                label: localized("yearReview.charges", "Charges"),
                value: Double(summary.totalChargeSessions),
                locale: locale
            ),
            stat(
                .co2,
                label: localized("yearReview.co2KgSaved", "kg CO₂ saved"),
                value: summary.co2OffsetKg,
                locale: locale
            )
        ]
    }

    private static func stat(
        _ kind: SummaryStatKind,
        label: String,
        value: Double,
        locale: Locale
    ) -> SummaryStat {
        SummaryStat(kind: kind, label: label, formattedValue: decimalString(value, fractionDigits: 0, locale: locale))
    }

    /// The savings line, present only when `gas_savings > 0` (web conditional). The
    /// rounded amount is interpolated into the localized `Saved $%@ vs. gas` template
    /// (web default `Saved ${{amount}} vs. gas`).
    private static func savings(from summary: YearReviewSummary, locale: Locale) -> SummarySavings? {
        guard summary.gasSavings > 0 else { return nil }
        let amount = Int(summary.gasSavings.rounded())
        let amountText = decimalString(Double(amount), fractionDigits: 0, locale: locale)
        let template = SummarySlideStrings.string("yearReview.savedSummary", "Saved $%@ vs. gas")
        return SummarySavings(amount: amount, text: String(format: template, amountText))
    }
}

// MARK: - Formatting helpers

public extension SummaryProjection {
    /// Returns the trimmed value, or the em-dash when blank (null-safety floor).
    static func nonEmpty(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? emDash : trimmed
    }

    /// Locale-grouped decimal string (web `AnimatedNumber` with `decimals`).
    static func decimalString(_ value: Double, fractionDigits: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }

    private static func localized(_ key: String, _ fallback: String) -> String {
        SummarySlideStrings.string(key, fallback)
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the status chip (web freshness indicator superset).
public enum SummarySlideFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive surface for the current data state — exhaustive so each
/// branch is unit-tested. The web slide always renders its card (the page-level
/// query owns loading/error); this superset adds the prompt's loading / empty /
/// stale / offline / error chrome while preserving the card as the loaded state.
public enum SummarySlidePresentation: Equatable, Sendable {
    case loading
    case empty
    case offlineNoData
    case error(retryable: Bool)
    case content(SummaryProjection, freshness: SummarySlideFreshness, refreshing: Bool)
}

public extension SummarySlidePresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) to a
    /// render-ready presentation. Keeps any cached summary visible behind a
    /// refresh/error; a zero-activity review becomes the friendly empty state.
    static func resolve(
        state: SummarySlideLoadState<YearReviewSummary>,
        distanceUnit: DistanceDisplayUnit,
        now _: Date = Date(),
        locale: Locale = .current
    ) -> SummarySlidePresentation {
        func project(_ summary: YearReviewSummary) -> SummaryProjection {
            SummaryProjection.make(from: summary, distanceUnit: distanceUnit, locale: locale)
        }

        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached, !cached.isEmpty else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)
        case let .loaded(summary, stale):
            return summary.isEmpty
                ? .empty
                : .content(project(summary), freshness: stale ? .stale : .live, refreshing: false)
        case .empty:
            return .empty
        case let .failed(error, cached, stale):
            return resolveFailure(error, cached: cached, stale: stale, project: project)
        }
    }

    private static func resolveFailure(
        _ error: SummarySlideError,
        cached: YearReviewSummary?,
        stale: Bool,
        project: (YearReviewSummary) -> SummaryProjection
    ) -> SummarySlidePresentation {
        if error == .offline {
            guard let cached, !cached.isEmpty else { return .offlineNoData }
            return .content(project(cached), freshness: .offline, refreshing: false)
        }
        if let cached, !cached.isEmpty {
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: false)
        }
        return .error(retryable: error.isRetryable)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver summary spoken for the whole card. Pure + public so the
/// a11y content is unit-tested without rendering the view.
public enum SummarySlideAccessibility {
    public static func cardSummary(for projection: SummaryProjection) -> String {
        var parts: [String] = [
            "\(projection.header.titleText) \(projection.header.yearText)",
            "\(projection.header.vehicleName) \(projection.header.vehicleModel)"
        ]
        parts += projection.stats.map { "\($0.formattedValue) \($0.label)" }
        if let savings = projection.savings {
            parts.append(savings.text)
        }
        return parts.joined(separator: ", ")
    }
}
