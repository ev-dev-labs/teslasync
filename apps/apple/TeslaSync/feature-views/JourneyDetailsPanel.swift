//
//  JourneyDetailsPanel.swift
//  TeslaSync — P4 feature view · 0144 · JourneyDetailsPanel (Apple)
//
//  The composable drive-detail journey panel — the SwiftUI parity of
//  features/driving/components/drive-detail/JourneyDetailsPanel.tsx. Renders every state from this
//  prompt's States section (loading skeleton / content / empty / error / stale / offline): the
//  "Journey Details" header, the Start + Destination endpoint columns (address-or-coordinates,
//  vehicle-local timestamp, battery), and the freshness chrome — binding through `JourneyDetailsModel`
//  (P1/S8). No networking lives here; the freshness chip + auto-refresh reflect the bound source's
//  live-state.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension JourneyDetailsStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - JourneyDetailsPanel (the drive-detail journey panel)

/// The composable drive-detail journey panel — the SwiftUI parity of
/// `features/driving/components/drive-detail/JourneyDetailsPanel.tsx`. The web leaf is a pure
/// presentational component taking a non-optional `drive`; this surface adds the prompt-required
/// loading / empty / error / stale / offline states as a strict superset over the same content,
/// binding through `JourneyDetailsModel` (P1/S8) so the view performs no routing or networking itself.
public struct JourneyDetailsPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = JourneyDetailsSurface.slug

    @State private var model: JourneyDetailsModel

    /// - Parameter model: the P1/S8 state-holder the panel binds through.
    public init(model: JourneyDetailsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    JourneyDetailsHeader(
                        connection: model.connection,
                        isFetching: model.isFetching,
                        updatedAt: model.updatedAt,
                        showsChip: showsFreshnessChip
                    )
                    if showsConnectivityBanner {
                        JourneyConnectivityBanner(connection: model.connection)
                    }
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }

    /// The freshness chip appears only while fetching or when the bound source is stale/offline (the
    /// prompt's stale-chip / offline-chip states); a live, idle panel stays chrome-free like the web.
    private var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }

    /// The connectivity banner sits above resolved content when a cached journey is shown stale or
    /// offline, so the cached values are never mistaken for live ones.
    private var showsConnectivityBanner: Bool {
        model.phase == .content && model.connection != .live
    }
}

// MARK: - Content states

private extension JourneyDetailsPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            JourneyDetailsSkeleton()
        case .empty:
            JourneyDetailsEmpty()
        case let .error(message):
            JourneyDetailsErrorView(message: message, onRetry: { model.refresh() })
        case .content:
            if let projection = model.projection {
                JourneyDetailsContent(projection: projection)
            } else {
                JourneyDetailsEmpty()
            }
        }
    }
}
