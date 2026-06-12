//
//  WidgetChartSummary.Model.swift
//  TeslaSync — P4 widget primitive · 0002 · WidgetChartSummary (Apple)
//
//  Pure (SwiftUI-free) model, layout decision, accessibility, i18n facade and telemetry seam for
//  the WidgetChartSummary primitive — the native parity of
//  features/dashboard/widgets/shared/WidgetChartSummary.tsx. Keeping these Foundation-only lets the
//  projection/layout logic compile and unit-test on a plain host; the SwiftUI chrome layers on top
//  in WidgetChartSummary.swift.
//
//  WidgetChartSummary is a shared widget building block: a stat row above a chart slot, with a
//  friendly empty state and a stats-only compact variant. It owns no networking and no data
//  source — every input is supplied by the hosting widget (web: a pure presentational component).
//

import CoreGraphics
import Foundation
import OSLog

// MARK: - Stat model (web `ChartSummaryStat`)

/// One labelled metric in the summary stat row — the native port of the web `ChartSummaryStat`
/// (`{ label, value: string | number, unit? }`). `value` is pre-formatted (the caller applies the
/// locale) so the cell stays a pure presentation type, exactly as the web component renders
/// `{stat.value}` verbatim.
public struct ChartSummaryStat: Identifiable, Equatable, Sendable {
    /// Mirrors the web `key={stat.label}` — the label is the stable identity.
    public var id: String {
        label
    }

    public let label: String
    public let value: String
    public let unit: String?

    public init(label: String, value: String, unit: String? = nil) {
        self.label = label
        self.value = value
        self.unit = unit
    }
}

public extension ChartSummaryStat {
    /// Numeric convenience covering the web `value: string | number` union: formats a floating-point
    /// value with grouping and up-to-`fractionDigits` decimals using the current locale.
    init(label: String, value: Double, unit: String? = nil, fractionDigits: Int = 0) {
        let digits = max(0, fractionDigits)
        let formatted = value.formatted(.number.precision(.fractionLength(0 ... digits)).grouping(.automatic))
        self.init(label: label, value: formatted, unit: unit)
    }

    /// Integer convenience for the `value: number` branch.
    init(label: String, value: Int, unit: String? = nil) {
        self.init(label: label, value: value.formatted(.number.grouping(.automatic)), unit: unit)
    }
}

// MARK: - Responsive layout decision (web `grid-cols-2` default → `@sm:flex` row)

/// Pure layout decisions for the primitive, mirroring the web component's conditional render
/// branches so they can be unit-tested without SwiftUI.
public enum WidgetChartSummaryLayout {
    /// Web `@sm` container breakpoint (≈ 24rem) at which the 2-column stat grid relaxes into a
    /// single horizontal flex row.
    public static let rowBreakpoint: CGFloat = 384

    /// Whether the stat row should lay out as a single horizontal row (web `@sm:flex @sm:gap-4`).
    /// Compact mode always forces the 2-column grid (web `compact ? 'grid-cols-2' : '… @sm:flex'`),
    /// and a not-yet-measured width (`0`) defaults to the mobile-safe 2-column grid.
    public static func usesRow(availableWidth: CGFloat, compact: Bool) -> Bool {
        guard !compact else { return false }
        return availableWidth >= rowBreakpoint
    }

    /// Web `{!compact && <div>{chart}</div>}` — the chart slot only renders outside compact mode.
    public static func showsChart(compact: Bool) -> Bool {
        !compact
    }

    /// Web `{stats.length > 0 && <grid/>}` — the stat row only renders when there are stats.
    public static func showsStats(_ stats: [ChartSummaryStat]) -> Bool {
        !stats.isEmpty
    }
}

// MARK: - Accessibility

/// VoiceOver label builders for the primitive's non-interactive content.
public enum WidgetChartSummaryAccessibility {
    /// Spoken label for one stat cell: `"<label>: <value> <unit>"` (the unit is dropped when absent),
    /// so the muted micro-label and the value are read as a single, meaningful element.
    public static func statLabel(for stat: ChartSummaryStat) -> String {
        if let unit = stat.unit, !unit.isEmpty {
            return "\(stat.label): \(stat.value) \(unit)"
        }
        return "\(stat.label): \(stat.value)"
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` diagnostics event for a surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core telemetry
/// (consent-gated and redacted there). Only the stable surface slug is emitted — never PII.
public protocol WidgetChartSummaryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event carrying only the public surface slug.
public struct OSLogWidgetChartSummaryTelemetry: WidgetChartSummaryTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "WidgetChartSummary" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. The web source is anonymous (no extracted
/// i18n keys); the single literal it carries is the empty-state default `'No data available'`.
public enum WidgetChartSummaryStrings {
    public static let table = "WidgetChartSummary"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
