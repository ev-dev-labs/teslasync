//
//  TripLegList.swift
//  TeslaSync — P4 feature view · 0177 · TripLegList (Apple)
//
//  The route breakdown — the SwiftUI parity of
//  features/driving/components/TripLegList.tsx. Renders the web source's titled
//  GlassPanel with either the friendly empty state or the per-leg cards (the from→to
//  header, the distance / duration / energy / battery metrics, and the interleaved
//  charge stop) plus the P4 leaf contract states. Binds through `TripLegListModel`
//  (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton leg cards (web parent `isLoading`).
//    • empty    — resolved with no legs → the EmptyState inside the panel
//                 (web `legItems.length === 0`).
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the titled panel with the interleaved leg + charge-stop cards.
//    • stale / offline — the orthogonal `connection` axis → a freshness chip beneath
//                 the panel with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - TripLegList (the feature surface)

/// The route breakdown — the SwiftUI parity of
/// `features/driving/components/TripLegList.tsx`. Renders every state from the web
/// source plus the P4 leaf freshness states, binding through `TripLegListModel`.
public struct TripLegList: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TripLegList"

    @State private var model: TripLegListModel

    public init(model: TripLegListModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                TripLegListFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            TripLegListLoadingView()
        case .empty:
            TripLegListEmptyView()
        case let .error(message):
            TripLegListErrorView(message: message) {
                model.refresh()
            }
        case .data:
            TripLegListContentView(rows: model.resolved.rows)
        }
    }
}

// MARK: - Localization facade SwiftUI bridge (P1/S10) — web `t(key, default)`

public extension TripLegListStrings {
    /// Resolves a per-surface key to a verbatim `Text`. The "TripLegList" table is
    /// resolved via `NSLocalizedString(tableName:)` (not the main catalog), so the
    /// localized value is rendered verbatim rather than re-looked-up as a SwiftUI
    /// `LocalizedStringKey`.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves a per-surface key to a `LocalizedStringKey` carrying the already-
    /// localized value, so shared components that require a `LocalizedStringKey`
    /// (e.g. `TSEmptyState`, `TSButton`) display the TripLegList-table string in
    /// every locale.
    static func label(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}
