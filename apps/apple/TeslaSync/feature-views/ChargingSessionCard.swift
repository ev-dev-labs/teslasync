//
//  ChargingSessionCard.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The charging-session list row — the SwiftUI parity of the web
//  features/charging/components/ChargingSessionCard.tsx. Switches over the model's
//  render phase (loading skeleton / loaded card / friendly empty / hard error) and
//  layers a freshness chip when the live feed is stale or offline. The card itself
//  is a slot-based history row (web `HistoryListRow`): an optional selection
//  checkbox, a leading battery-friendly score badge, a primary line (time +
//  duration + charger / energy / free / anomaly badges), the charger location, and
//  (in comfortable density) the metrics line. Binds through `ChargingSessionCardModel`
//  (P1/S8); no networking lives here.
//

import SwiftUI

// MARK: - String facade `Text` helper (keeps the model layer SwiftUI-free)

public extension ChargingSessionCardStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - ChargingSessionCard (the feature surface)

/// The charging-session row. Renders every state from the web source plus the
/// native stale/offline chrome, and always shows a surface (never a blank box).
public struct ChargingSessionCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ChargingSessionCardSurface.slug

    @State private var model: ChargingSessionCardModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter model: the bound view-model (built over a `ChargingSessionCardSource`).
    public init(model: ChargingSessionCardModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.phase)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChargingSessionCardSkeleton()
        case let .error(message):
            ChargingSessionCardErrorView(message: message) { model.refresh() }
        case .empty:
            ChargingSessionCardEmptyState()
        case .loaded:
            loadedContent
        }
    }

    @ViewBuilder
    private var loadedContent: some View {
        if let projection = model.projection {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live {
                    ChargingSessionFreshnessChip(connection: model.connection) { model.refresh() }
                }
                ChargingSessionRowView(
                    projection: projection,
                    anomaly: model.anomaly,
                    density: model.density,
                    selected: model.selected,
                    selectable: model.selectable,
                    formatting: model.formatting,
                    localize: model.localize,
                    onToggleSelect: { model.toggleSelect($0) },
                    onOpen: { model.open() }
                )
            }
        } else {
            ChargingSessionCardEmptyState()
        }
    }
}
