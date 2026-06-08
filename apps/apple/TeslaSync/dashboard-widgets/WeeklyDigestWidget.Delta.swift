//
//  WeeklyDigestWidget.Delta.swift
//  TeslaSync — P4 dashboard widget · 0116 · WeeklyDigestWidget (Apple)
//
//  The comparison-delta value model shared by the projector (WeeklyDigestWidget.Adapter.swift) and
//  the metric row view (WeeklyDigestWidget.Views.swift): the direction + semantic tone the web
//  shared `Delta` component resolves, the resolved per-metric result, and the metric identity that
//  fixes row order + `higherIsBetter`. Foundation-only so it executes on a plain host.
//
//  Parity target: web/src/components/data-display/Delta.tsx +
//  web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx.
//

import Foundation

// MARK: - Delta model (web `Delta` direction + semantic colour)

/// The arrow direction the web `Delta` renders from the sign of `current - previous`.
public enum WeeklyDigestDeltaDirection: String, Sendable, Equatable {
    case up
    case down
    case flat
}

/// The semantic tone the web `colorForDelta` resolves: muted when unchanged, otherwise emerald for a
/// "good" move and rose for a "bad" one given the metric's `higherIsBetter`.
public enum WeeklyDigestDeltaTone: String, Sendable, Equatable {
    case positive
    case negative
    case neutral
}

/// The resolved web `Delta` for one metric: the percent text (or em-dash), arrow direction, semantic
/// tone, and a spoken VoiceOver clause.
public struct WeeklyDigestDeltaResult: Equatable {
    public let text: String
    public let direction: WeeklyDigestDeltaDirection
    public let tone: WeeklyDigestDeltaTone
    public let accessibilityClause: String

    public init(
        text: String,
        direction: WeeklyDigestDeltaDirection,
        tone: WeeklyDigestDeltaTone,
        accessibilityClause: String
    ) {
        self.text = text
        self.direction = direction
        self.tone = tone
        self.accessibilityClause = accessibilityClause
    }
}

// MARK: - Metric identity (web `WidgetComparisonCard` `metrics` array)

/// Which comparison metric a row represents — fixes the row order + `higherIsBetter` exactly as the
/// web `metrics` array (distance, drives, energy, efficiency).
public enum WeeklyDigestMetricKind: String, Sendable, Equatable, CaseIterable {
    case distance
    case drives
    case energy
    case efficiency

    /// Web `higherIsBetter` flag per metric (efficiency = lower is better).
    public var higherIsBetter: Bool {
        self != .efficiency
    }
}
