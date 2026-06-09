//
//  SignalChartPanel.Localization.swift
//  TeslaSync — P4 feature view · 0266 · SignalChartPanel (Apple)
//
//  The P1/S10 localization facade + the testable accessibility summaries. Both are
//  Foundation-only so the strings resolve through the per-surface catalog table
//  (no hardcoded literals in the view) and the VoiceOver content can be unit-tested
//  without rendering.
//
//  The web `SignalChartPanel` calls `t()` with English string keys
//  ("Live Signal Stream", "events", "points", …); native maps each to a stable
//  dotted key carrying that exact English value as its `NSLocalizedString` fallback,
//  so the rendered copy is identical while staying translatable. The grid empty key
//  (`smallMultiples.noData`) is kept verbatim from the web `SmallMultiplesChart`.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SignalChartPanel" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum SignalChartStrings {
    public static let table = "SignalChartPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// --- Titles (web `resolvedTitle`) ---
    public static var titleLive: String {
        string("telemetry.signalChart.titleLive", "Live Signal Stream")
    }

    public static var titleHistorical: String {
        string("telemetry.signalChart.title", "Signal Chart")
    }

    /// --- Header annotation nouns (web `t('events')` / `t('points')`) ---
    public static var eventsNoun: String {
        string("telemetry.signalChart.events", "events")
    }

    public static var pointsNoun: String {
        string("telemetry.signalChart.points", "points")
    }

    public static var pointsLoadedNoun: String {
        string("telemetry.signalChart.pointsLoaded", "points loaded")
    }

    /// --- Empty bodies (web waiting / no-data branches) ---
    public static var waiting: String {
        string("telemetry.signalChart.waiting", "Waiting for signal data…")
    }

    public static var noData: String {
        string("telemetry.signalChart.noData", "No data for this time range")
    }

    /// Web `SmallMultiplesChart` empty-cell label (verbatim web key).
    public static var gridNoData: String {
        string("smallMultiples.noData", "No data")
    }

    /// --- Freshness chip (Live / Stale / Offline) ---
    public static var live: String {
        string("telemetry.signalChart.live", "Live")
    }

    public static var stale: String {
        string("telemetry.signalChart.stale", "Stale")
    }

    public static var offline: String {
        string("telemetry.signalChart.offline", "Offline")
    }

    /// --- Connectivity banner ---
    public static var staleBanner: String {
        string("telemetry.signalChart.staleBanner", "Reconnecting — values may be stale")
    }

    public static var offlineBanner: String {
        string("telemetry.signalChart.offlineBanner", "Offline — showing the last loaded chart")
    }

    /// --- Loading / error chrome ---
    public static var loadingLabel: String {
        string("telemetry.signalChart.loading", "Loading signal chart")
    }

    public static var errorTitle: String {
        string("telemetry.signalChart.errorTitle", "Couldn't load signal chart")
    }

    public static var retry: String {
        string("telemetry.signalChart.retry", "Retry")
    }

    /// --- Accessibility ---
    public static var legendLabel: String {
        string("telemetry.signalChart.a11y.legend", "Signal legend")
    }

    /// The live event / point counter line (web `{events} events · {points} points`).
    public static func liveCounter(events: Int, points: Int, locale: Locale = .current) -> String {
        let eventsText = SignalChartFormat.int(events, locale: locale)
        let pointsText = SignalChartFormat.int(points, locale: locale)
        return "\(eventsText) \(eventsNoun) · \(pointsText) \(pointsNoun)"
    }

    /// The historical points-loaded annotation (web `{pointsLoaded} points loaded`).
    public static func pointsLoadedText(_ count: Int, locale: Locale = .current) -> String {
        "\(SignalChartFormat.int(count, locale: locale)) \(pointsLoadedNoun)"
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum SignalChartAccessibility {
    /// The chart-level summary: title + layout + signal count + point count, e.g.
    /// "Live Signal Stream: overlay chart, 3 signals, 120 points".
    public static func chartSummary(
        isLive: Bool,
        mode: SignalChartEffectiveMode,
        signalCount: Int,
        pointCount: Int,
        localize: (String, String) -> String
    ) -> String {
        let title = isLive
            ? localize("telemetry.signalChart.titleLive", "Live Signal Stream")
            : localize("telemetry.signalChart.title", "Signal Chart")
        let layout = mode == .grid
            ? localize("telemetry.signalChart.a11y.grid", "grid")
            : localize("telemetry.signalChart.a11y.overlay", "overlay")
        let chartNoun = localize("telemetry.signalChart.a11y.chart", "chart")
        let signalsNoun = localize("telemetry.signalChart.a11y.signals", "signals")
        let pointsNoun = localize("telemetry.signalChart.a11y.points", "points")
        return "\(title): \(layout) \(chartNoun), \(signalCount) \(signalsNoun), \(pointCount) \(pointsNoun)"
    }

    /// One series' VoiceOver value for the legend / tooltip: "{name}: {value}". The
    /// value is already formatted by the caller (axis label / tooltip number).
    public static func seriesLabel(name: String, value: String) -> String {
        "\(name): \(value)"
    }
}
