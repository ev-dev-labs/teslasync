//
//  AlertsSection.Adapter.swift
//  TeslaSync — P4 feature view · 0071 · AlertsSection (Apple)
//
//  The testable projection core for the weekly-digest "Alerts" surface — the
//  faithful port of features/analytics/components/weekly-digest/AlertsSection.tsx.
//  Everything here is pure and dependency-free (Foundation only) so it can be
//  unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web component takes `metrics` (with `alertsByType: Record<string, number>`
//      and `alertTotal`) plus a pre-built `alertPieData`. Both derive from the same
//      severity→count map the parent `useWeeklyDigest` computes, so the native source
//      seam provides that one canonical map and this adapter projects BOTH the
//      "Alerts by Severity" rows and the donut slices from it (DRY + one tested seam).
//    • Severity strings are free-form on the web (`alert.severity`); the known set is
//      critical / warning / info. `AlertSeverityKind` maps those to semantic kinds and
//      routes anything else to `.other`, which renders the capitalized raw key exactly
//      like the web `severity.charAt(0).toUpperCase() + severity.slice(1)`.
//    • The web `alertTotal === 0 ? <EmptyState> : <grid>` split becomes the resolved
//      `.empty` vs `.content` phase, widened with the loading / error load envelope
//      the parent page owns.
//

import Foundation

// MARK: - Severity kind (web severity string → semantic kind)

/// The semantic classification of an alert severity. The web keys (critical /
/// warning / info) map to the matching cases; any other string routes to `.other`
/// so unknown severities still render (web shows the capitalized raw value).
public enum AlertSeverityKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case critical
    case warning
    case info
    case other

    public var id: String {
        rawValue
    }

    /// Display + plot order — critical first, then warning, info, and `.other` last.
    /// The web preserves `Object.entries` insertion order; the native dictionary is
    /// unordered, so we sort by severity priority for a deterministic, sensible UI.
    public var order: Int {
        switch self {
        case .critical: 0
        case .warning: 1
        case .info: 2
        case .other: 3
        }
    }

    /// Maps a raw web severity string to a semantic kind (case-insensitive; unknown
    /// values → `.other`).
    public static func from(_ raw: String) -> AlertSeverityKind {
        switch raw.lowercased() {
        case "critical": .critical
        case "warning": .warning
        case "info": .info
        default: .other
        }
    }

    /// The i18n key the severity label resolves through (web capitalized severity).
    public var localizationKey: String {
        switch self {
        case .critical: "analytics.weeklyDigest.severity.critical"
        case .warning: "analytics.weeklyDigest.severity.warning"
        case .info: "analytics.weeklyDigest.severity.info"
        case .other: "analytics.weeklyDigest.severity.other"
        }
    }

    /// The web English fallback for `localizationKey`.
    public var fallback: String {
        switch self {
        case .critical: "Critical"
        case .warning: "Warning"
        case .info: "Info"
        case .other: "Other"
        }
    }
}

// MARK: - Severity datum (one "Alerts by Severity" row + one donut slice)

/// One severity bucket: its raw web key, the semantic kind, and the count. Drives
/// both a left-column row (web `<GlassPanel>` per `[severity, count]`) and a donut
/// slice (web `alertPieData` entry).
public struct AlertSeverityDatum: Sendable, Equatable, Identifiable {
    /// The original web severity string (the `alertsByType` key).
    public var rawKey: String
    /// The semantic classification of `rawKey`.
    public var kind: AlertSeverityKind
    /// The number of alerts at this severity in the week.
    public var count: Int

    public var id: String {
        rawKey
    }

    public init(rawKey: String, kind: AlertSeverityKind, count: Int) {
        self.rawKey = rawKey
        self.kind = kind
        self.count = count
    }

    /// The display label: the localized name for a known kind, or the capitalized
    /// raw key for an unknown one (web `severity.charAt(0).toUpperCase() + slice(1)`
    /// rendered with a `capitalize` class). Copy resolves through the injected
    /// localizer so this stays bundle-free + testable.
    public func label(localize: (String, String) -> String) -> String {
        kind == .other
            ? AlertsProjection.capitalizeFirst(rawKey)
            : localize(kind.localizationKey, kind.fallback)
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (`alertTotal === 0`); the loading / error envelope around it
/// (prompt P4 states) is supplied by the bound source, mirroring the parent
/// weekly-digest page's `isLoading` / error wiring.
public enum AlertsPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the digest query (web `isLoading` / resolved
/// / failure), projected into a phase by `resolvePhase`.
public enum AlertsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so cached counts are clearly labeled while reconnecting / offline.
public enum AlertsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the raw severity→count map to ordered
/// severity data + render phase. A faithful port of the web component's read of
/// `metrics.alertsByType` / `alertTotal` / `alertPieData`.
public enum AlertsProjection {
    /// Ordered severity data from the raw counts map. Sorted by severity priority
    /// (critical → warning → info → other) and then the raw key for stable ties.
    /// Negative counts clamp to zero (defensive; the web counts are always ≥ 1).
    public static func data(from counts: [String: Int]) -> [AlertSeverityDatum] {
        counts
            .map { key, value in
                AlertSeverityDatum(rawKey: key, kind: .from(key), count: max(0, value))
            }
            .sorted { lhs, rhs in
                lhs.kind.order == rhs.kind.order
                    ? lhs.rawKey < rhs.rawKey
                    : lhs.kind.order < rhs.kind.order
            }
    }

    /// The total alert count across all severities (web `metrics.alertTotal`).
    public static func total(_ data: [AlertSeverityDatum]) -> Int {
        data.reduce(0) { $0 + $1.count }
    }

    /// The fraction (0...1) one severity contributes to the total (donut share).
    /// Returns 0 when the total is 0 so an empty donut never divides by zero.
    public static func fraction(_ datum: AlertSeverityDatum, of data: [AlertSeverityDatum]) -> Double {
        let sum = total(data)
        guard sum > 0 else { return 0 }
        return Double(datum.count) / Double(sum)
    }

    /// Resolves the render phase from the bound load status + the total count (web
    /// `alertTotal === 0 ? empty : content`).
    public static func resolvePhase(_ status: AlertsLoadStatus, total: Int) -> AlertsPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            total > 0 ? .content : .empty
        }
    }

    /// Capitalizes the first character only, leaving the rest unchanged — the web
    /// `s.charAt(0).toUpperCase() + s.slice(1)` (NOT a full title-case).
    public static func capitalizeFirst(_ value: String) -> String {
        guard let first = value.first else { return value }
        return first.uppercased() + value.dropFirst()
    }
}

// MARK: - Formatting (web `fmtInt`)

/// Locale-aware integer formatting, the native parity of the web `fmtInt` helper
/// (grouped, no fraction digits). Pure + testable.
public enum AlertsFormat {
    public static func count(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum AlertsSectionSurface {
    public static let slug = "AlertsSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum AlertsAccessibility {
    /// The section-level summary: title + total + per-severity counts, or the
    /// friendly empty message when there are none.
    public static func sectionSummary(
        data: [AlertSeverityDatum],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("analytics.weeklyDigest.alertsSection", "Alerts")
        let sum = AlertsProjection.total(data)
        guard sum > 0 else {
            let none = localize(
                "analytics.weeklyDigest.noAlerts",
                "No alerts this week — everything looks great!"
            )
            return "\(title): \(none)"
        }
        let parts = data.map { "\($0.count) \($0.label(localize: localize))" }
        return "\(title): \(sum), " + parts.joined(separator: ", ")
    }

    /// One severity row's VoiceOver value: "{label}: {count}".
    public static func rowLabel(
        _ datum: AlertSeverityDatum,
        localize: (String, String) -> String
    ) -> String {
        "\(datum.label(localize: localize)): \(datum.count)"
    }
}
