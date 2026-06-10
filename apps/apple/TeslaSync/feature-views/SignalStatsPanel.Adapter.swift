//
//  SignalStatsPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0272 · SignalStatsPanel (Apple)
//
//  The testable projection core for the per-signal min/max/avg/count summary — the
//  SwiftUI parity of features/telemetry/components/SignalStatsPanel.tsx and the web
//  helpers it is fed by: `fmtNumber` / `fmtInt` (lib/numberFormat.ts) and the
//  `CHART_COLORS` index mapping (lib/colors.ts). Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the row model, the
//  gap-filling for selected signals, the locale number formatting, the empty-row
//  bookkeeping, and the colour index are all unit tested in isolation.
//
//  Parity note: the web panel is presentation-only. It is handed a `stats` array
//  (one `SignalStat` per signal that produced numeric samples) plus an optional
//  `selectedSignals` list; when the latter is present it emits one row per selected
//  signal, back-filling absent signals with an em-dash row carrying a "no data"
//  hint. This core reproduces that exactly and never invents or rescales values.
//

import Foundation

// MARK: - Signal stat model (web `SignalStat` from useLiveSignalStream.ts)

/// One per-signal summary — the native mirror of the web `SignalStat`. `min`,
/// `max`, and `avg` are carried as the upstream numbers (the parent computes them
/// over the queried range); a non-finite value means "no numeric sample" and the
/// view renders the em-dash. `sampleCount` is the web `count` field (renamed so the
/// member does not collide with the `empty_count` lint rule).
public struct SignalStat: Equatable, Sendable {
    public var signal: String
    public var min: Double
    public var max: Double
    public var avg: Double
    public var sampleCount: Int

    public init(signal: String, min: Double, max: Double, avg: Double, sampleCount: Int) {
        self.signal = signal
        self.min = min
        self.max = max
        self.avg = avg
        self.sampleCount = sampleCount
    }

    /// Web `isEmptyStat(s)` — a signal with no numeric samples in the queried range.
    public var isEmpty: Bool {
        sampleCount == 0
    }

    /// Web `emptyStatRow(signal)` — the back-fill row for a selected signal that
    /// produced no numeric samples (NaN min/max/avg, zero count).
    public static func empty(signal: String) -> SignalStat {
        SignalStat(signal: signal, min: .nan, max: .nan, avg: .nan, sampleCount: 0)
    }
}

// MARK: - Display row (web computed `displayStats` entry + colour index)

/// One resolved, view-ready row — the native mirror of a web `displayStats` entry
/// once the colour index is applied. The numeric fields stay raw so the view
/// formats them through `SignalStatsFormat`; `colorIndex` selects the brand series
/// colour (web `CHART_COLORS[max(0, idx) % len]`).
public struct SignalStatRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let signal: String
    public let colorIndex: Int
    public let min: Double
    public let max: Double
    public let avg: Double
    public let sampleCount: Int

    public init(signal: String, colorIndex: Int, min: Double, max: Double, avg: Double, sampleCount: Int) {
        id = signal
        self.signal = signal
        self.colorIndex = colorIndex
        self.min = min
        self.max = max
        self.avg = avg
        self.sampleCount = sampleCount
    }

    /// Web `isEmptyStat` — the row has no numeric samples, so it renders the "no
    /// data" hint and em-dash cells.
    public var isEmpty: Bool {
        sampleCount == 0
    }
}

// MARK: - Number formatting (ports of numberFormat.ts fmtNumber / fmtInt)

/// Pure number formatting ported from the web helpers so the rounding, the
/// grouping separators, and the non-finite handling match the source exactly. The
/// web global precision is 2 and `safeNumber` coerces non-finite input to 0; both
/// are reproduced here.
public enum SignalStatsFormat {
    /// The em-dash sentinel the web renders for a missing / non-finite value.
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction
    /// digits, half-away rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtInt(v)` — `fmtNumber(v, 0)`, a zero-fraction-digit locale
    /// format with grouping.
    public static func int(_ value: Int, locale: Locale = .current) -> String {
        number(Double(value), decimals: 0, locale: locale)
    }

    /// Web `renderNumeric`: a non-finite value renders the em-dash, otherwise the
    /// 2-decimal locale number. Shared by the min / max / avg cells.
    public static func numeric(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite else { return dash }
        return number(value, locale: locale)
    }
}

// MARK: - Row building (web `displayStats` + colour index + empty bookkeeping)

/// Builds the view-ready rows from the panel inputs — the native port of the web
/// `displayStats` memo (the `selectedSignals` gap-fill) plus the per-row colour
/// index (`signalIndex?[signal] ?? position`). Kept pure so the gap-filling, the
/// ordering, the colour mapping, and the empty-row bookkeeping are unit tested
/// without a rendered view.
public enum SignalStatRows {
    /// Web `displayStats`: when `selectedSignals` is non-empty, emit one row per
    /// selected signal (absent signals back-filled with an em-dash row); otherwise
    /// pass `stats` through unchanged. Each row carries the resolved colour index.
    public static func rows(
        stats: [SignalStat],
        selectedSignals: [String]? = nil,
        signalIndex: [String: Int]? = nil
    ) -> [SignalStatRow] {
        displayStats(stats: stats, selectedSignals: selectedSignals)
            .enumerated()
            .map { position, stat in
                let resolvedIndex = signalIndex?[stat.signal] ?? position
                return SignalStatRow(
                    signal: stat.signal,
                    colorIndex: Swift.max(0, resolvedIndex),
                    min: stat.min,
                    max: stat.max,
                    avg: stat.avg,
                    sampleCount: stat.sampleCount
                )
            }
    }

    /// Web `hideEmpty ? displayStats.filter((s) => !isEmptyStat(s)) : displayStats`.
    public static func visible(_ rows: [SignalStatRow], hideEmpty: Bool) -> [SignalStatRow] {
        hideEmpty ? rows.filter { !$0.isEmpty } : rows
    }

    /// Web `emptyCount` — the number of rows that have no numeric samples.
    public static func emptyCount(_ rows: [SignalStatRow]) -> Int {
        rows.reduce(0) { running, row in running + (row.isEmpty ? 1 : 0) }
    }

    private static func displayStats(stats: [SignalStat], selectedSignals: [String]?) -> [SignalStat] {
        guard let selected = selectedSignals, !selected.isEmpty else { return stats }
        let byName = Dictionary(stats.map { ($0.signal, $0) }, uniquingKeysWith: { first, _ in first })
        return selected.map { byName[$0] ?? SignalStat.empty(signal: $0) }
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for a stat row from already-localised parts, so the
/// spoken content is asserted without rendering the view.
public enum SignalStatsAccessibility {
    /// Joins a signal name with its already-localised stat detail (or the "no data"
    /// wording) into the row's VoiceOver label.
    public static func rowLabel(signal: String, detail: String) -> String {
        "\(signal), \(detail)"
    }

    /// The non-empty stat detail joined from already-localised label / value pairs
    /// (e.g. "Min 0.00, Max 112.40, Avg 47.21, Count 8,421").
    public static func statDetail(_ parts: [(label: String, value: String)]) -> String {
        parts.map { "\($0.label) \($0.value)" }.joined(separator: ", ")
    }
}
