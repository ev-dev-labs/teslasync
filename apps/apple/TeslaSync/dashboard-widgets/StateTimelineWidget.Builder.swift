//
//  StateTimelineWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0096 · StateTimelineWidget (Apple)
//
//  The pure cached → projection adapter: a faithful Swift port of the web
//  StateTimelineWidget.tsx derive block — `buildSegments` (stacked-bar / list
//  percentages) and the `TimelineStripe` per-transition slice mapping (24h
//  stripe, sub-0.5% slices dropped). No SwiftUI / transport — this is the
//  unit-tested core both platforms agree on.
//

import Foundation

// MARK: - StateTimelineBuilder (port of the web widget's derive block)

/// Pure functions that turn the cached `/vehicle-states/summary` +
/// `/vehicle-states/timeline` snapshots into the display `STWProjection`.
/// A 1:1 port of the web source so both platforms show identical percentages.
public enum StateTimelineBuilder {
    /// The web drops 24h-stripe slices narrower than this (`if (pct < 0.5) return null`).
    public static let minStripePct: Double = 0.5

    /// Port of the web `buildSegments`: `total = Σ totalMin`; returns `[]` when
    /// the total is zero (the empty-state gate), else each segment's
    /// `pct = totalMin / total * 100`. A blank/whitespace state is shown as the
    /// web's `?? '—'` em-dash fallback.
    public static func buildSegments(_ data: [StateSummaryEntry]) -> [StateSegment] {
        let totalMin = data.reduce(0) { $0 + safe($1.totalMin) }
        guard totalMin > 0 else { return [] }
        return data.map { entry in
            let mins = safe(entry.totalMin)
            let raw = emDashIfBlank(entry.state)
            return StateSegment(
                rawState: raw,
                kind: VehicleStateKind.from(raw: raw),
                pct: (mins / totalMin) * 100,
                totalMin: mins,
                count: entry.count
            )
        }
    }

    /// Port of the web `TimelineStripe` cell mapping: `total = Σ durationMin`;
    /// returns `[]` when zero (the web renders no stripe), else each transition's
    /// `pct = durationMin / total * 100`, dropping slices under `minStripePct`.
    /// The original transition index is preserved as the slice identity so the
    /// stripe stays stable across refreshes.
    public static func buildStripe(_ transitions: [StateTransitionEntry]) -> [StateStripeSegment] {
        let totalMin = transitions.reduce(0) { $0 + safe($1.durationMin) }
        guard totalMin > 0 else { return [] }
        var slices: [StateStripeSegment] = []
        slices.reserveCapacity(transitions.count)
        for (index, transition) in transitions.enumerated() {
            let mins = safe(transition.durationMin)
            let pct = (mins / totalMin) * 100
            guard pct >= minStripePct else { continue }
            slices.append(
                StateStripeSegment(
                    index: index,
                    rawState: transition.state,
                    kind: VehicleStateKind.from(raw: transition.state),
                    pct: pct,
                    durationMin: mins
                )
            )
        }
        return slices
    }

    /// Builds the full projection from both cached snapshots (web `segments` +
    /// `transitions`). `segments` drives the empty-state gate; `stripe` only
    /// renders in the wide layout.
    public static func project(
        summary: [StateSummaryEntry],
        transitions: [StateTransitionEntry]
    ) -> STWProjection {
        STWProjection(
            segments: buildSegments(summary),
            stripe: buildStripe(transitions)
        )
    }

    /// Non-finite / negative guard (the web treats missing minutes as `?? 0`).
    private static func safe(_ value: Double) -> Double {
        value.isFinite ? max(0, value) : 0
    }

    /// The web `state ?? '—'` em-dash fallback, extended to blank/whitespace strings.
    private static func emDashIfBlank(_ state: String) -> String {
        state.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "—" : state
    }
}
