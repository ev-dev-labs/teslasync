//
//  FleetSummary.swift
//  TeslaSync — P4 feature view · 0276 · FleetSummary (Apple)
//
//  The composable Fleet Summary surface — the SwiftUI parity of
//  features/vehicles/components/FleetSummary.tsx. It renders the four headline fleet stats
//  (total vehicles, average battery %, total rated range, charging / online) as a row of
//  glass tiles, reproducing the web aggregation + SI-distance conversion + number
//  formatting exactly. It renders every state — loading skeleton, content (with the stale
//  / offline freshness chrome), empty (no vehicles), error (retryable) — through
//  `FleetSummaryModel` (P1/S8). No networking lives here; the surface emits the P1/S11
//  `view.opened`.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension FleetSummaryStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the
    /// model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - FleetSummary (the stat surface)

/// The composable Fleet Summary surface, binding through `FleetSummaryModel` (P1/S8).
/// No networking lives here.
public struct FleetSummary: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = FleetSummarySurface.slug

    @State private var model: FleetSummaryModel

    public init(model: FleetSummaryModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            Group {
                switch model.phase {
                case .loading:
                    FleetSummaryLoadingChrome()
                case .empty:
                    emptyState
                case .error:
                    errorState
                case .content:
                    content
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }

    /// The four-tile composition, with the freshness chip surfaced above the grid while
    /// stale / offline / fetching (web tile row stays chrome-free when live).
    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.showsFreshnessChip {
                HStack {
                    Spacer(minLength: 0)
                    FleetSummaryFreshnessChip(
                        connection: model.connection,
                        isFetching: model.isFetching,
                        ageLabel: model.ageLabel
                    )
                }
            }
            FleetSummaryGrid(metrics: model.metrics)
        }
    }

    /// The no-vehicles empty state — never a blank box (web query is disabled when the
    /// fleet is empty).
    private var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                FleetSummaryStrings.string("fleet.summary.empty.title", "No vehicles")
            ),
            message: LocalizedStringKey(
                FleetSummaryStrings.string("fleet.summary.empty.message", "Add a vehicle to see fleet stats")
            ),
            systemImage: "car.2"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    /// The fleet-state query failure state with a retry affordance (web `QueryError`).
    private var errorState: some View {
        TSQueryError(
            message: LocalizedStringKey(
                FleetSummaryStrings.string("fleet.summary.error.message", "Couldn't load fleet stats")
            )
        ) {
            model.refresh()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}
