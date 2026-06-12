//
//  UptimeHeatmap.Model.swift
//  TeslaSync — P4 shared surface · 0202 · UptimeHeatmap (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for
//  the rolling N-day status grid. The web component binds only `useTranslation` (its data is props), so
//  the native peer needs no data state-holder. What the holder DOES own is the surface lifecycle: it
//  carries the current ``UptimeHeatmapInputs``, derives the pure ``UptimeHeatmapProjection`` as an
//  observed read (SwiftUI observation replaces the React re-render), composes the localized heading /
//  uptime caption / per-square labels through the facade, and emits the surface's single `view.opened`
//  diagnostics event. No networking lives here; the derivation is the pure projection, so the holder is
//  a thin, testable shell.
//
//  i18n note: the web source's fixed copy is the default heading (`Uptime — last N days`), the caption
//  suffix (`… uptime`), the five status labels (web `STATUS_LABEL`), the grid `aria-label` (`Daily
//  status history`), and each square's `aria-label` (`{date}: {label}`). The native peer mirrors every
//  one as a localizable key/format (so the word order + separators translate) and adds a friendly empty
//  state (a native HIG affordance the web omits). All of it resolves through the P1/S10 facade so the
//  Swift sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback (mirroring the web source's copy),
/// so the Swift sources hold no hardcoded prose. Keys live in the "UptimeHeatmap" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; in test / preview bundles `NSLocalizedString`
/// returns the `value:` fallback, keeping the derivation deterministic.
public enum UptimeHeatmapStrings {
    public static let table = "UptimeHeatmap"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The heading — the caller's override (web `title`, already localized) when present, else the
    /// default composed from the day count (web `Uptime — last ${days.length} days`). The default is a
    /// localizable format (`%d`) so the word order + separators translate.
    public static func heading(titleOverride: String?, dayCount: Int) -> String {
        if let titleOverride, !titleOverride.isEmpty {
            return titleOverride
        }
        let format = string("uptimeHeatmap.title", "Uptime — last %d days")
        return String(format: format, dayCount)
    }

    /// The uptime caption — web `${fmtPercent(uptimePct, 2)} uptime`. The percent text is pre-formatted
    /// (the "%"-suffixed number); the suffix word is a localizable format (`%@`) so it translates.
    public static func uptimeCaption(percentText: String) -> String {
        let format = string("uptimeHeatmap.uptimeCaption", "%@ uptime")
        return String(format: format, percentText)
    }

    /// One status's display label — the native peer of the web `STATUS_LABEL` map.
    public static func statusLabel(_ status: UptimeStatus) -> String {
        switch status {
        case .healthy: string("uptimeHeatmap.status.healthy", "Operational")
        case .degraded: string("uptimeHeatmap.status.degraded", "Degraded")
        case .unhealthy: string("uptimeHeatmap.status.unhealthy", "Outage")
        case .unknown: string("uptimeHeatmap.status.unknown", "Unknown")
        case .maintenance: string("uptimeHeatmap.status.maintenance", "Maintenance")
        }
    }

    /// One square's VoiceOver label — web `aria-label={`${day.date}: ${STATUS_LABEL[day.status]}`}`. A
    /// localizable format (`%1$@` / `%2$@`) so the separator + order translate.
    public static func squareAccessibilityLabel(date: String, statusLabel: String) -> String {
        let format = string("uptimeHeatmap.squareAccessibility", "%1$@: %2$@")
        return String(format: format, date, statusLabel)
    }

    /// The grid container's VoiceOver label — web `aria-label="Daily status history"`.
    public static var gridAccessibilityLabel: String {
        string("uptimeHeatmap.gridAccessibility", "Daily status history")
    }

    /// The friendly empty-state title (native HIG affordance — never a blank box).
    public static var emptyTitle: String {
        string("uptimeHeatmap.empty.title", "No status history")
    }

    /// The friendly empty-state message (native HIG affordance).
    public static var emptyMessage: String {
        string("uptimeHeatmap.empty.message", "Daily status appears here once health history is recorded.")
    }
}

// MARK: - ResolvedUptimeSquare (localized, view-ready square)

/// One square as the view renders it — the index-keyed ``UptimeSquare`` plus the localized status label
/// and the composed VoiceOver label. Produced by the model (which owns the facade) so the view stays
/// prose-free and the localization is asserted in one place.
public struct ResolvedUptimeSquare: Identifiable, Equatable {
    /// The day's position in the window (the `ForEach` key).
    public let id: Int
    /// The day's status driving the fill colour.
    public let status: UptimeStatus
    /// ISO date shown verbatim in the popover header (web `day.date`).
    public let dateText: String
    /// The localized status label (web `STATUS_LABEL[day.status]`).
    public let statusLabel: String
    /// Optional summary shown in the popover (web `day.summary`).
    public let summary: String?
    /// The composed VoiceOver label — "{date}: {status label}" (web square `aria-label`).
    public let accessibilityLabel: String

    public init(
        id: Int,
        status: UptimeStatus,
        dateText: String,
        statusLabel: String,
        summary: String?,
        accessibilityLabel: String
    ) {
        self.id = id
        self.status = status
        self.dateText = dateText
        self.statusLabel = statusLabel
        self.summary = summary
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol UptimeHeatmapTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogUptimeHeatmapTelemetry: UptimeHeatmapTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - UptimeHeatmapModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``UptimeHeatmapInputs`` (the props),
/// derives the pure ``UptimeHeatmapProjection`` as an observed read, composes the localized heading /
/// uptime caption / per-square labels through the facade, and emits `view.opened` exactly once per
/// instance. The web component has no fetcher, so neither does this holder — `update(_:)` is the native
/// peer of React re-rendering with new props, reassigning only when the inputs actually change.
@MainActor
@Observable
public final class UptimeHeatmapModel {
    /// The current props (web `props`). Reading it (or anything derived from it) registers an
    /// observation dependency, so the surface re-renders when the days / title / footnote change.
    public private(set) var inputs: UptimeHeatmapInputs

    @ObservationIgnored private let telemetry: any UptimeHeatmapTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        inputs: UptimeHeatmapInputs,
        telemetry: any UptimeHeatmapTelemetry = OSLogUptimeHeatmapTelemetry()
    ) {
        self.inputs = inputs
        self.telemetry = telemetry
    }

    /// The resolved, view-ready layout decisions (web render output).
    public var projection: UptimeHeatmapProjection {
        UptimeHeatmapProjector.resolve(inputs: inputs)
    }

    /// The heading — the caller's override or the day-count default (web `title ?? `Uptime — last N…``).
    public var heading: String {
        UptimeHeatmapStrings.heading(titleOverride: projection.titleOverride, dayCount: projection.dayCount)
    }

    /// The uptime caption (web `${fmtPercent}% uptime`); `nil` when the window is empty (no caption).
    public var uptimeCaption: String? {
        projection.uptimePercentText.map(UptimeHeatmapStrings.uptimeCaption(percentText:))
    }

    /// The caption colour tier (web caption ternary); `nil` when empty.
    public var tier: UptimeTier? {
        projection.tier
    }

    /// The grid container's VoiceOver label (web `aria-label="Daily status history"`).
    public var gridAccessibilityLabel: String {
        UptimeHeatmapStrings.gridAccessibilityLabel
    }

    /// Whether the window is empty (web `days.length === 0`).
    public var isEmpty: Bool {
        projection.isEmpty
    }

    /// The optional footnote (web `footnote`).
    public var footnote: String? {
        projection.footnote
    }

    /// The friendly empty-state title (native HIG affordance).
    public var emptyTitle: String {
        UptimeHeatmapStrings.emptyTitle
    }

    /// The friendly empty-state message (native HIG affordance).
    public var emptyMessage: String {
        UptimeHeatmapStrings.emptyMessage
    }

    /// The localized, view-ready squares — one per day, oldest-first (web `days.map`), each carrying its
    /// status label + composed VoiceOver label so the view holds no prose.
    public var resolvedSquares: [ResolvedUptimeSquare] {
        projection.squares.map { square in
            let label = UptimeHeatmapStrings.statusLabel(square.status)
            return ResolvedUptimeSquare(
                id: square.id,
                status: square.status,
                dateText: square.date,
                statusLabel: label,
                summary: square.summary,
                accessibilityLabel: UptimeHeatmapStrings.squareAccessibilityLabel(
                    date: square.date,
                    statusLabel: label
                )
            )
        }
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ inputs: UptimeHeatmapInputs) {
        guard inputs != self.inputs else { return }
        self.inputs = inputs
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance, never again on a later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: UptimeHeatmapSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()`` for the host's appear/disappear lifecycle;
    /// the once-only `view.opened` contract is preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
