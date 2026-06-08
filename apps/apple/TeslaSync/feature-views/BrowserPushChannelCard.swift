//
//  BrowserPushChannelCard.swift
//  TeslaSync — P4 feature view · 0181 · BrowserPushChannelCard (Apple)
//
//  The browser/OS push notification channel card — the SwiftUI parity of the web
//  features/notifications/components/BrowserPushChannelCard.tsx. Switches over the
//  model's render phase (loading skeleton / hard error + retry / friendly empty /
//  loaded card) and layers a freshness chip when the live feed is stale or offline.
//  The loaded card reproduces every web branch: the header (icon chip + title +
//  subtitle + status badge), the unsupported amber callout OR the enable/disable
//  affordance + iOS note, and the registered-device list with per-row revoke. Binds
//  through `BrowserPushChannelCardModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The browser push channel card. Renders every state from the web source plus the
/// native stale/offline chrome, and always shows a surface (never a blank box).
public struct BrowserPushChannelCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = BrowserPushChannelCardSurface.slug

    @State private var model: BrowserPushChannelCardModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter model: the bound view-model (built over a `BrowserPushChannelCardSource`).
    public init(model: BrowserPushChannelCardModel) {
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
            BrowserPushChannelCardSkeleton()
        case let .error(message):
            BrowserPushChannelCardErrorView(message: message) { model.refresh() }
        case .empty, .loaded:
            loadedCard
        }
    }

    /// The full card — the web `GlassPanel` body. Present in both the `loaded` and
    /// `empty` phases; only the device section swaps to its empty state when empty.
    private var loadedCard: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if model.connection != .live {
                    BrowserPushFreshnessChip(connection: model.connection) { model.refresh() }
                }
                BrowserPushChannelCardHeader(status: model.status, localize: model.localize)
                bodyRegion
                BrowserPushDevicesSection(
                    devices: model.deviceProjections,
                    localize: model.localize,
                    onRemove: { model.remove(endpoint: $0) }
                )
            }
        }
    }

    /// Web `isUnsupported ? <amber callout> : <enable/disable + iOS note>`.
    @ViewBuilder
    private var bodyRegion: some View {
        if let reason = model.unsupportedReason {
            BrowserPushUnsupportedBanner(reason: reason, localize: model.localize)
        } else {
            BrowserPushActionRow(
                isSubscribed: model.capability?.isSubscribed ?? false,
                localize: model.localize,
                onEnable: { model.enable() },
                onDisable: { model.disable() }
            )
        }
    }
}
