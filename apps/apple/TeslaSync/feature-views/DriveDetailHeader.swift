//
//  DriveDetailHeader.swift
//  TeslaSync — P4 feature view · 0137 · DriveDetailHeader (Apple)
//
//  The composable drive-detail masthead — the SwiftUI parity of
//  features/driving/components/drive-detail/DriveDetailHeader.tsx. Renders every state from the web
//  source (loading skeleton / empty / error / stale / offline / content): a back affordance, the
//  route (or "Drive Details" fallback) title, the vehicle + timestamp subtitle, and the Replay /
//  Share actions, binding through `DriveDetailHeaderModel` (P1/S8). No networking lives here; the
//  freshness chip + auto-refresh reflect the bound source's live-state.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension DriveDetailHeaderStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - DriveDetailHeader (the drive-detail masthead)

/// The composable drive-detail masthead — the SwiftUI parity of
/// `features/driving/components/drive-detail/DriveDetailHeader.tsx`. Renders every state from the web
/// source plus the back / Replay / Share affordances, binding through `DriveDetailHeaderModel`
/// (P1/S8). Navigation + share are surfaced as closures (the native parity of the web `<Link>`s +
/// `onShare` prop) so the view performs no routing or networking itself.
public struct DriveDetailHeader: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DriveDetailHeaderSurface.slug

    @State private var model: DriveDetailHeaderModel
    private let onBack: () -> Void
    private let onReplay: (String) -> Void
    private let onShare: () -> Void

    /// - Parameters:
    ///   - model: the P1/S8 state-holder the masthead binds through.
    ///   - onBack: pops the drive-detail route (web `<Link to="/drives">`).
    ///   - onReplay: opens the replay route for the given drive id (web `<Link to="…/replay">`).
    ///   - onShare: presents the share sheet (web `onShare` prop).
    public init(
        model: DriveDetailHeaderModel,
        onBack: @escaping () -> Void = {},
        onReplay: @escaping (String) -> Void = { _ in },
        onShare: @escaping () -> Void = {}
    ) {
        _model = State(initialValue: model)
        self.onBack = onBack
        self.onReplay = onReplay
        self.onShare = onShare
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if showsFreshnessChip {
                    freshnessHeader
                }
                content
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

    /// The masthead is chrome-free when live + idle; the freshness chip appears only while fetching or
    /// when the bound source is stale/offline (the prompt's stale-chip / offline-chip states).
    private var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }
}

// MARK: - Header

private extension DriveDetailHeader {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            DriveDetailHeaderFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt
            )
        }
    }
}

// MARK: - Content states

private extension DriveDetailHeader {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            DriveDetailHeaderSkeleton(onBack: onBack)
        case .empty:
            DriveDetailHeaderEmpty(onBack: onBack)
        case let .error(message):
            DriveDetailHeaderErrorView(message: message, onBack: onBack, onRetry: { model.refresh() })
        case .content:
            if let projection = model.projection {
                masthead(projection)
            } else {
                DriveDetailHeaderEmpty(onBack: onBack)
            }
        }
    }

    /// The resolved masthead row: back affordance + title/subtitle block + Replay/Share actions, the
    /// parity of the web `<div className="flex items-center gap-4">`.
    func masthead(_ projection: DriveHeaderProjection) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            DriveDetailHeaderBackButton(action: onBack)
            DriveDetailHeaderTitleBlock(projection: projection)
            DriveDetailHeaderActions(
                onReplay: { onReplay(projection.driveID) },
                onShare: onShare
            )
        }
    }
}
