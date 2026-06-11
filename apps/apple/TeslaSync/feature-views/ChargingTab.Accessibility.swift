//
//  ChargingTab.Accessibility.swift
//  TeslaSync — P4 feature view · 0054 · ChargingTab (Apple)
//
//  The VoiceOver value builders for the surface's cards + chart panels, split out of the
//  projection core (sibling precedent: feature-views/OverviewTab.Accessibility). Pure + public so
//  the spoken content can be unit-tested without rendering; the view passes pre-localized nouns +
//  formatters so no English literal lives here.
//

import Foundation

/// Builds the VoiceOver value strings for the summary cards + chart panels.
public enum ChargingTabAccessibility {
    /// "{label}: {value} {subtitle}" for a summary card (or "{label}: {value}" with no subtitle).
    public static func summaryCardLabel(label: String, value: String, subtitle: String?) -> String {
        guard let subtitle, !subtitle.isEmpty else { return "\(label): \(value)" }
        return "\(label): \(value) \(subtitle)"
    }

    /// "{n} {rangesNoun}, {total} {totalNoun}" for a histogram, or the empty fallback.
    public static func distributionSummary(
        bars: [ChargingTabDistributionBar],
        rangesNoun: String,
        totalNoun: String,
        emptyFallback: String
    ) -> String {
        guard !bars.isEmpty else { return emptyFallback }
        let total = Int(bars.reduce(0) { $0 + $1.count }.rounded())
        return "\(bars.count) \(rangesNoun), \(total) \(totalNoun)"
    }

    /// "{n} {typesNoun}, {total} {totalNoun}" for the charger-type donut, or the empty fallback —
    /// the count of types plus their combined session total (web `count` sum).
    public static func chargerTypesSummary(
        slices: [ChargingTabChargerTypeSlice],
        typesNoun: String,
        totalNoun: String,
        emptyFallback: String,
        formatInt: (Double) -> String
    ) -> String {
        guard !slices.isEmpty else { return emptyFallback }
        let total = slices.reduce(0.0) { $0 + $1.count }
        return "\(slices.count) \(typesNoun), \(formatInt(total)) \(totalNoun)"
    }

    /// "{count} {noun}" for a series, or the empty fallback when there is nothing to read.
    public static func countSummary(_ count: Int, noun: String, emptyFallback: String) -> String {
        count > 0 ? "\(count) \(noun)" : emptyFallback
    }
}
