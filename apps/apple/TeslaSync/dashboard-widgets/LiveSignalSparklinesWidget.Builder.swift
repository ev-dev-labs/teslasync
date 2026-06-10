//
//  LiveSignalSparklinesWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0057 · LiveSignalSparklinesWidget (Apple)
//
//  The pure adapter (cached DTO → projection). A 1:1 port of the derivation logic
//  in the web source: signal selection (config ∩ available, ≤ 6), PascalCase name
//  spacing, numeric coercion of live values, history filtering, quarter-vs-quarter
//  trend, the value formatter, the responsive layout split, and the shell phase /
//  freshness resolution. Foundation-only and side-effect-free so it is unit-tested
//  by an executed headless harness.
//

import Foundation

/// Stateless projector that turns a `LiveSignalSparklinesUpdate` into the row list
/// + chrome state the SwiftUI surface renders. Every function is pure.
public enum LiveSignalSparklinesBuilder {
    /// The web `DEFAULT_SIGNALS` fallback list.
    public static let defaultSignals = [
        "BatteryLevel",
        "VehicleSpeed",
        "OutsideTemp",
        "InsideTemp",
        "Odometer",
        "PackCurrent"
    ]

    /// The web caps the configurable list at 4–6 signals (`.slice(0, 6)`).
    public static let maxSignals = 6

    // MARK: Signal selection (port of `configuredSignals` memo)

    /// Picks the signals to render: the configured list (or `defaultSignals` when
    /// unset) intersected with the available set, capped at `maxSignals`. When no
    /// availability is known yet, the raw list is shown; when none of the
    /// configured signals are available, the first `maxSignals` available are used
    /// (insertion order preserved, matching the web `Array.from(available)`).
    public static func selectSignals(configured: [String]?, available: [String]) -> [String] {
        let raw = configured ?? defaultSignals
        let availableSet = Set(available)
        if availableSet.isEmpty {
            return Array(raw.prefix(maxSignals))
        }
        let filtered = raw.filter { availableSet.contains($0) }
        if filtered.isEmpty {
            return Array(available.prefix(maxSignals))
        }
        return Array(filtered.prefix(maxSignals))
    }

    // MARK: Name + value formatting

    /// Pretty-prints a PascalCase signal name as spaced words — a direct port of
    /// the web `formatSignalName` (two regex passes: lower→Upper and ACRONYM→Word).
    public static func formatSignalName(_ name: String) -> String {
        var out = name.replacingOccurrences(
            of: "([a-z])([A-Z])",
            with: "$1 $2",
            options: .regularExpression
        )
        out = out.replacingOccurrences(
            of: "([A-Z]+)([A-Z][a-z])",
            with: "$1 $2",
            options: .regularExpression
        )
        return out
    }

    /// Extracts a finite display number from a live value (port of
    /// `extractNumericValue`): numbers pass through when finite, strings are parsed
    /// for a leading float (JS `parseFloat` semantics), everything else is `nil`.
    public static func extractNumericValue(_ value: LiveSignalValue?) -> Double? {
        switch value {
        case let .number(number):
            return number.isFinite ? number : nil
        case let .text(text):
            guard let parsed = parseLeadingDouble(text), parsed.isFinite else { return nil }
            return parsed
        case .bool, .none:
            return nil
        }
    }

    /// Parses the leading numeric prefix of a string the way JS `parseFloat` does
    /// ("12.5 kWh" → 12.5, "abc" → nil), so stringified telemetry still charts.
    public static func parseLeadingDouble(_ text: String) -> Double? {
        let scanner = Scanner(string: text)
        scanner.charactersToBeSkipped = .whitespaces
        guard let value = scanner.scanDouble() else { return nil }
        return value
    }

    /// The finite numeric points of a history window (port of the `numericPoints`
    /// memo: drop nil / non-finite samples).
    public static func numericPoints(_ history: [SignalHistorySample]) -> [Double] {
        history.compactMap(\.valueNum).filter(\.isFinite)
    }

    /// Formats the current value with one fraction digit + locale grouping (port of
    /// `fmtNumber(currentValue, 1)`); `nil` renders an em dash like the web.
    public static func formatValue(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 1
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.1f", value)
    }

    // MARK: Trend (port of the `trend` memo)

    /// Compares the first-quarter average to the last-quarter average of the
    /// window; a move larger than `max(|earlyAvg| · 1%, 0.1)` is up/down, else flat.
    /// Windows shorter than four points are always flat.
    public static func trend(for points: [Double]) -> SignalTrend {
        guard points.count >= 4 else { return .flat }
        let quarter = max(1, points.count / 4)
        let earlyAvg = points.prefix(quarter).reduce(0, +) / Double(quarter)
        let lateAvg = points.suffix(quarter).reduce(0, +) / Double(quarter)
        let delta = lateAvg - earlyAvg
        let scaled = abs(earlyAvg) * 0.01
        let threshold = scaled == 0 ? 0.1 : scaled
        if delta > threshold { return .up }
        if delta < -threshold { return .down }
        return .flat
    }

    // MARK: Row + list projection

    /// Projects one signal into its renderable row (port of `SignalSparklineRow`
    /// derived state).
    public static func projectRow(
        signal: String,
        colorIndex: Int,
        liveValue: LiveSignalValue?,
        history: [SignalHistorySample]
    ) -> SignalRowProjection {
        let points = numericPoints(history)
        return SignalRowProjection(
            signal: signal,
            displayName: formatSignalName(signal),
            currentValue: extractNumericValue(liveValue),
            points: points,
            hasSparkline: points.count >= 2,
            trend: trend(for: points),
            colorIndex: colorIndex
        )
    }

    /// Projects the full row list for a snapshot — the headline "cached → projection"
    /// adapter the view binds to.
    public static func projectRows(_ update: LiveSignalSparklinesUpdate) -> [SignalRowProjection] {
        let isEmptyLoadingState = update.status == .loading
            && update.availableSignals.isEmpty
            && update.configuredSignals == nil
            && update.liveValues.isEmpty
            && update.histories.isEmpty
        if isEmptyLoadingState {
            return []
        }
        let signals = selectSignals(configured: update.configuredSignals, available: update.availableSignals)
        return signals.enumerated().map { index, signal in
            projectRow(
                signal: signal,
                colorIndex: index,
                liveValue: update.liveValues[signal],
                history: update.histories[signal] ?? []
            )
        }
    }

    // MARK: Responsive layout (port of `isWide` / `useTwoColumns`)

    /// Wide layout (wider sparklines) at 3+ columns.
    public static func isWide(cols: Int) -> Bool {
        cols >= 3
    }

    /// Two-column grid at 3+ columns when more than three signals are shown.
    public static func useTwoColumns(cols: Int, rowCount: Int) -> Bool {
        cols >= 3 && rowCount > 3
    }

    // MARK: Shell phase + freshness resolution

    /// Resolves the shell render branch. Whenever rows are known they stay visible
    /// (errors/staleness surface in the chip); only an empty resolved list shows the
    /// empty state, and only a rowless initial fetch shows the skeleton.
    public static func resolvePhase(status: SignalLoadStatus, rowCount: Int) -> SignalRenderPhase {
        if rowCount > 0 { return .content }
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded, .empty:
            return .empty
        }
    }

    /// Resolves the freshness chip status (offline ▸ error ▸ fetching ▸ stale ▸
    /// fresh), mirroring the web `DataFreshness` precedence with the native offline
    /// addition.
    public static func resolveFreshness(_ update: LiveSignalSparklinesUpdate) -> SignalFreshness {
        if update.connection == .offline { return .offline }
        if update.isError { return .error }
        if update.isFetching { return .fetching }
        if update.connection == .stale { return .stale }
        return .fresh
    }

    // MARK: Relative time (port of the web `formatRelativeTime`)

    /// A localized "just now / 5m ago / 2h ago / 3d ago / 1w ago" label for the
    /// freshness chip, matching the web minute/hour/day/week buckets.
    public static func relativeTime(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 {
            return LiveSignalSparklinesStrings.string("widget.freshness.justNow", "just now")
        }
        if seconds < 3600 {
            return LiveSignalSparklinesStrings.count("widget.freshness.minutes", "%lldm ago", seconds / 60)
        }
        if seconds < 86400 {
            return LiveSignalSparklinesStrings.count("widget.freshness.hours", "%lldh ago", seconds / 3600)
        }
        if seconds < 604_800 {
            return LiveSignalSparklinesStrings.count("widget.freshness.days", "%lldd ago", seconds / 86400)
        }
        return LiveSignalSparklinesStrings.count("widget.freshness.weeks", "%lldw ago", seconds / 604_800)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver copy spoken for a signal row + freshness chip. Pure +
/// public so the spoken content can be unit-tested without rendering the view.
public enum LiveSignalSparklinesAccessibility {
    /// "Battery Level, 76.0, trending up" — name, formatted value, spoken trend.
    public static func rowLabel(for row: SignalRowProjection) -> String {
        let value = LiveSignalSparklinesBuilder.formatValue(row.currentValue)
        return "\(row.displayName), \(value), \(trendPhrase(row.trend))"
    }

    /// The localized spoken trend phrase.
    public static func trendPhrase(_ trend: SignalTrend) -> String {
        switch trend {
        case .up:
            LiveSignalSparklinesStrings.string("widget.trendUp", "trending up")
        case .down:
            LiveSignalSparklinesStrings.string("widget.trendDown", "trending down")
        case .flat:
            LiveSignalSparklinesStrings.string("widget.trendFlat", "holding steady")
        }
    }

    /// The localized freshness label spoken by the chip / used as its label.
    public static func freshnessLabel(_ freshness: SignalFreshness) -> String {
        switch freshness {
        case .fresh:
            LiveSignalSparklinesStrings.string("widget.freshness.live", "Live")
        case .fetching:
            LiveSignalSparklinesStrings.string("widget.freshness.updating", "Updating…")
        case .stale:
            LiveSignalSparklinesStrings.string("widget.freshness.stale", "Stale")
        case .error:
            LiveSignalSparklinesStrings.string("widget.freshness.error", "Error")
        case .offline:
            LiveSignalSparklinesStrings.string("widget.freshness.offline", "Offline")
        }
    }
}
