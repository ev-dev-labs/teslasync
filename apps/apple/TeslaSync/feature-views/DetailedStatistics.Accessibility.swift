//
//  DetailedStatistics.Accessibility.swift
//  TeslaSync — P4 feature view · 0101 · DetailedStatistics (Apple)
//
//  The VoiceOver string builders for the charging-list "Detailed Statistics" panel. Pure and
//  dependency-free (Foundation only): copy resolves through an injected localizer so the summaries
//  are testable without a bundle, exactly like the view's P1/S10 facade. Kept beside the adapter so
//  the projection's tiles and their spoken labels never diverge.
//

import Foundation

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade.
public enum DetailedStatisticsAccessibility {
    /// The visible / spoken label for a tile: the localized base label plus the Top Charger "(N×)"
    /// suffix when present. Shared by the view and the VoiceOver strings so they never diverge.
    public static func composedLabel(
        _ metric: DetailedStatistic,
        localize: (String, String) -> String
    ) -> String {
        let base = localize(metric.labelKey, metric.labelFallback)
        guard let count = metric.labelCount else { return base }
        return "\(base) (\(count)×)"
    }

    /// The section-level summary: the panel title followed by each tile's "{label} {value}", or the
    /// friendly empty message when there are no statistics.
    public static func sectionSummary(
        metrics: [DetailedStatistic],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("charging.stats.detailedStatistics", "Detailed Statistics")
        guard !metrics.isEmpty else {
            let none = localize("charging.stats.noData", "No charging statistics available yet")
            return "\(title): \(none)"
        }
        let parts = metrics.map { "\(composedLabel($0, localize: localize)) \($0.value)" }
        return "\(title): " + parts.joined(separator: ", ")
    }

    /// One tile's VoiceOver value: "{label}: {value}".
    public static func tileLabel(
        _ metric: DetailedStatistic,
        localize: (String, String) -> String
    ) -> String {
        "\(composedLabel(metric, localize: localize)): \(metric.value)"
    }
}
