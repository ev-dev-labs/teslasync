//
//  SignalLogWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0089 · SignalLogWidget (Apple)
//
//  The pure adapter (cached DTO → projection). A 1:1 port of the derivation logic
//  in the web source: the value formatter (`formatSignalValue`), the source →
//  label/tone mapping, the observation → feed-row projection (with the web id
//  shape), the descending sort + 20-row cap the web `WidgetEventFeed` applies, the
//  MQTT signals/sec aggregation, the relative-time bucketing, and the shell phase /
//  freshness resolution. Foundation-only and side-effect-free so it is unit-tested
//  by an executed headless harness.
//

import Foundation

/// Stateless projector that turns a `SignalLogUpdate` into the feed rows + chrome
/// state the SwiftUI surface renders. Every function is pure.
public enum SignalLogBuilder {
    /// The web passes `maxItems={20}` to the feed and requests `{ limit: 20 }`.
    public static let maxItems = 20

    /// Compact (big-number) layout threshold — the web `size.cols <= 1`.
    public static func isCompact(cols: Int) -> Bool {
        cols <= 1
    }

    // MARK: Value formatting (port of `formatSignalValue`)

    /// Renders an observation's value the way the web does: the numeric value when
    /// present, else the text value, else the boolean as `"true"`/`"false"`, else
    /// an em dash. A present-but-non-finite numeric renders the dash rather than a
    /// `"NaN"`/`"Infinity"` literal.
    public static func formatSignalValue(_ observation: SignalObservationDTO) -> String {
        if let numeric = observation.valueNumeric {
            return formatNumber(numeric)
        }
        if let text = observation.valueText {
            return text
        }
        if let flag = observation.valueBool {
            return flag ? "true" : "false"
        }
        return "—"
    }

    /// Locale-independent number rendering matching the web `String(value_numeric)`
    /// (a `.` decimal, no grouping, trailing zeros trimmed). Non-finite → em dash.
    public static func formatNumber(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 6
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    // MARK: Row + feed projection

    /// Projects one observation into its renderable row, preserving the web id
    /// shape (`ts-signal-index`) so SwiftUI diffing stays stable across pushes.
    public static func projectRow(_ observation: SignalObservationDTO, index: Int) -> SignalLogRowProjection {
        let title = observation.signalName ?? "—"
        let stamp = observation.timestamp.timeIntervalSince1970
        return SignalLogRowProjection(
            id: "\(stamp)-\(title)-\(index)",
            sourceLabel: observation.source.label,
            tone: observation.source.tone,
            isLiveBadge: observation.source.isLiveBadge,
            title: title,
            value: formatSignalValue(observation),
            timestamp: observation.timestamp
        )
    }

    /// Projects the full feed — the headline "cached → projection" adapter the view
    /// binds to. Mirrors the web `WidgetEventFeed`: newest first, capped at 20.
    public static func projectFeed(_ update: SignalLogUpdate, limit: Int = maxItems) -> [SignalLogRowProjection] {
        let rows = update.observations.enumerated().map { index, observation in
            projectRow(observation, index: index)
        }
        let sorted = rows.sorted { $0.timestamp > $1.timestamp }
        return Array(sorted.prefix(max(0, limit)))
    }

    // MARK: MQTT signals/sec aggregation (port of the `rate` memo)

    /// Sums the per-vehicle MQTT `signalsPerSecond` rates (web
    /// `vList.reduce((sum, v) => sum + (v.signalsPerSecond ?? 0), 0)`).
    public static func aggregateRate(_ rates: [Double]) -> Double {
        rates.reduce(0) { $0 + ($1.isFinite ? $1 : 0) }
    }

    /// The compact big number: the aggregate rate rounded to a whole number (web
    /// `Math.round(rate)`).
    public static func roundedRate(_ rate: Double) -> Int {
        guard rate.isFinite else { return 0 }
        return Int(rate.rounded())
    }

    // MARK: Shell phase + freshness resolution

    /// Resolves the shell render branch. Whenever rows are known they stay visible
    /// (errors/staleness surface in the chip); only an empty resolved feed shows
    /// the empty state, and only a rowless initial fetch shows the skeleton.
    public static func resolvePhase(status: SignalLogStatus, itemCount: Int) -> SignalLogRenderPhase {
        if itemCount > 0 { return .content }
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
    public static func resolveFreshness(_ update: SignalLogUpdate) -> SignalLogFreshness {
        if update.connection == .offline { return .offline }
        if update.isError { return .error }
        if update.isFetching { return .fetching }
        if update.connection == .stale { return .stale }
        return .fresh
    }

    // MARK: Relative time (port of the web feed `formatRelativeTime`)

    /// The row/chip time label: "Just now" under a minute, "%lldm ago" / "%lldh
    /// ago" within the hour/day, then a localized short date-time — matching the
    /// web `WidgetEventFeed.formatRelativeTime` buckets.
    public static func feedRelativeTime(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 {
            return SignalLogStrings.string("widget.signalLog.justNow", "Just now")
        }
        if seconds < 3600 {
            return SignalLogStrings.count("widget.signalLog.minutes", "%lldm ago", seconds / 60)
        }
        if seconds < 86400 {
            return SignalLogStrings.count("widget.signalLog.hours", "%lldh ago", seconds / 3600)
        }
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver copy spoken for a feed row + the freshness chip. Pure +
/// public so the spoken content can be unit-tested without rendering the view.
public enum SignalLogAccessibility {
    /// "Battery Level, 42.5, MQTT, 3m ago" — name, value, source, relative time.
    public static func rowLabel(for row: SignalLogRowProjection, now: Date = Date()) -> String {
        let time = SignalLogBuilder.feedRelativeTime(since: row.timestamp, now: now)
        return "\(row.title), \(row.value), \(row.sourceLabel), \(time)"
    }

    /// The localized freshness label spoken by the chip / used as its value.
    public static func freshnessLabel(_ freshness: SignalLogFreshness) -> String {
        switch freshness {
        case .fresh:
            SignalLogStrings.string("widget.signalLog.freshness.live", "Live")
        case .fetching:
            SignalLogStrings.string("widget.signalLog.freshness.updating", "Updating…")
        case .stale:
            SignalLogStrings.string("widget.signalLog.freshness.stale", "Stale")
        case .error:
            SignalLogStrings.string("widget.signalLog.freshness.error", "Error")
        case .offline:
            SignalLogStrings.string("widget.signalLog.freshness.offline", "Offline")
        }
    }

    /// The spoken signals/sec summary for the compact big number.
    public static func rateLabel(_ rate: Int) -> String {
        let unit = SignalLogStrings.string("widget.signalLog.signalsPerSec", "signals/sec")
        return "\(rate) \(unit)"
    }
}
