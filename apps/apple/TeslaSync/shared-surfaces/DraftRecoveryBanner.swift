//
//  DraftRecoveryBanner.swift
//  TeslaSync — P4 shared surface · 0116 · DraftRecoveryBanner (Apple)
//
//  The SwiftUI surface — the public API of the draft-recovery banner, the parity of the web
//  `components/feedback/DraftRecoveryBanner.tsx`. The view binds through `DraftRecoveryBannerModel`
//  (P1/S8) for the resolved banner + the once-only `view.opened` telemetry (P1/S11); no networking
//  lives here. Chrome is token-driven (P1/S9) and every string resolves through the P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the draft store is being read → skeleton banner chrome.
//    • empty   — no recovered draft (web `if (!hasDraft) return null`) → friendly empty state (the
//                native improvement over the web component rendering nothing), never a blank box.
//    • error   — the store read failed with no cached draft → a retryable error tile (web
//                `QueryError` peer).
//    • data    — the recovered-draft notice: the "{noun} draft restored from {when}." copy plus the
//                "Use draft" / "Discard draft" affordances; choosing either hides the banner.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the banner with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - DraftRecoveryBanner (the shared surface)

/// The draft-recovery banner — the SwiftUI parity of the web `DraftRecoveryBanner`. Renders every
/// state plus the P4 leaf freshness states, binding through `DraftRecoveryBannerModel`.
public struct DraftRecoveryBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DraftRecoveryBannerSurface.slug

    @State private var model: DraftRecoveryBannerModel

    public init(model: DraftRecoveryBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled-prop usage — the parity of the web parent mounting
    /// `<DraftRecoveryBanner hasDraft draftSavedAt itemNoun onRestore onDiscard />`. `onRestore` is
    /// optional (web present-only acknowledgement); `onDiscard` is required (the parent resets its
    /// editor and clears the stored draft).
    public init(
        hasDraft: Bool,
        draftSavedAt: Date?,
        itemNoun: String? = nil,
        connection: DraftRecoveryConnection = .live,
        onRestore: (@MainActor () -> Void)? = nil,
        onDiscard: @escaping @MainActor () -> Void
    ) {
        let source = StaticDraftRecoverySource(
            hasDraft: hasDraft,
            savedAt: draftSavedAt,
            itemNoun: itemNoun,
            connection: connection
        )
        _model = State(initialValue: DraftRecoveryBannerModel(
            source: source,
            onRestore: onRestore,
            onDiscard: onDiscard
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                DraftRecoveryFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DraftRecoveryLoadingView()
        case .empty:
            DraftRecoveryEmptyView()
        case let .error(message):
            DraftRecoveryErrorView(message: message) { model.refresh() }
        case .data:
            if let data = model.data {
                DraftRecoveryNoticeView(
                    data: data,
                    onRestore: { model.restore() },
                    onDiscard: { model.discard() }
                )
            }
        }
    }
}
