//
//  AchievementUnlockedToast.swift
//  TeslaSync — P4 shared surface · 0111 · AchievementUnlockedToast (Apple)
//
//  The SwiftUI surface — the public API of the achievement-unlocked celebration stack, the parity of
//  the web `AchievementUnlockedToastStack` (which renders one `AchievementUnlockedToast` per pending
//  unlock). The view binds through `AchievementUnlockedToastModel` (P1/S8) for the resolved queue + the
//  once-only `view.opened` telemetry (P1/S11); no networking lives here. Chrome is token-driven
//  (P1/S9) and every string resolves through the P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the unlock feed is connecting → skeleton toast chrome.
//    • empty   — connected, no pending unlocks → friendly empty state (the native improvement over the
//                web stack rendering nothing), never a blank box.
//    • error   — the feed failed with no cached toasts → a retryable error tile (web `QueryError` peer).
//    • data    — one toast per queued unlock, newest-first (web `events.map`).
//    • stale / offline — the orthogonal connectivity axis → freshness chip beneath the stack with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AchievementUnlockedToastStack (the shared surface)

/// The achievement-unlocked celebration stack — the SwiftUI parity of the web
/// `AchievementUnlockedToastStack`. Renders every state plus the P4 leaf freshness states, binding
/// through `AchievementUnlockedToastModel`.
public struct AchievementUnlockedToastStack: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AchievementUnlockedToast"

    @State private var model: AchievementUnlockedToastModel
    private let lifetimeSeconds: TimeInterval

    public init(
        model: AchievementUnlockedToastModel,
        lifetimeSeconds: TimeInterval = AchievementUnlockedLifetime.defaultSeconds
    ) {
        _model = State(initialValue: model)
        self.lifetimeSeconds = lifetimeSeconds
    }

    /// Convenience initializer for the controlled usage — the parity of the web parent mounting
    /// `<AchievementUnlockedToastStack events={recent} onDismiss={…} />`. Seeds a static source from the
    /// supplied queue + connectivity; `onView` is the embedder's navigator for an unlock's "View"
    /// affordance (the native peer of react-router resolving `/lifetime?achievement=<id>`).
    public init(
        events: [AchievementUnlockedEventData],
        connection: AchievementUnlockedConnection = .live,
        lifetimeSeconds: TimeInterval = AchievementUnlockedLifetime.defaultSeconds,
        onView: (@MainActor (AchievementUnlockedEventData) -> Void)? = nil
    ) {
        let update = AchievementUnlockedUpdate(
            status: events.isEmpty ? .empty : .loaded,
            connection: connection,
            events: events
        )
        let source = StaticAchievementUnlockedSource(update)
        _model = State(initialValue: AchievementUnlockedToastModel(source: source, onView: onView))
        self.lifetimeSeconds = lifetimeSeconds
    }

    public var body: some View {
        VStack(alignment: .trailing, spacing: TSSpacing.md) {
            content
            if model.connection != .live {
                AchievementUnlockedFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            AchievementUnlockedLoadingView()
        case .empty:
            AchievementUnlockedEmptyView()
        case let .error(message):
            AchievementUnlockedErrorView(message: message) { model.refresh() }
        case .data:
            stack
        }
    }

    /// The data render — one celebration toast per queued unlock, newest-first (web `events.map`).
    private var stack: some View {
        VStack(alignment: .trailing, spacing: TSSpacing.md) {
            ForEach(model.events) { event in
                AchievementUnlockedToast(
                    event: event,
                    lifetimeSeconds: lifetimeSeconds,
                    onView: { model.view(event) },
                    onDismiss: { model.dismiss(id: event.id) }
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}
