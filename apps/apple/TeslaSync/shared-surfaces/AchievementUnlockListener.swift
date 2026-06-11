//
//  AchievementUnlockListener.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  The achievement-unlock listener — the SwiftUI parity of `components/feedback/
//  AchievementUnlockListener.tsx`. The web component mounts at the app root, subscribes to the
//  realtime `achievement_unlocked` SSE stream (`useAchievementUnlocks`), reads the celebration prefs
//  (`useAchievementCelebrationPrefs`), plays an optional chime, and renders the celebration toast
//  stack (suppressing the visible toasts — but still draining the queue + chiming — when the user has
//  switched them off). This surface reproduces that composition natively, bound through
//  `AchievementUnlockListenerModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading       — the SSE feed is resolving → skeleton toast chrome.
//    • empty         — resolved with nothing to show: an empty queue ("No new achievements") or the
//                      celebrations-off opt-out → a friendly empty state, never a blank box.
//    • unavailable   — the feed failed → a retryable error tile (web `QueryError` peer).
//    • ready         — queued unlocks (toasts enabled) → the celebration toast stack.
//    • stale / offline — the orthogonal `connection` axis → a freshness chip beneath the stack with a
//                      one-shot auto-refresh on the stale transition; offline keeps the cached toasts.
//

import SwiftUI

// MARK: - AchievementUnlockListener (the shared surface)

/// The achievement-unlock listener — the SwiftUI parity of `AchievementUnlockListener.tsx`. Renders
/// every state plus the P4 leaf freshness states, binding through `AchievementUnlockListenerModel`.
public struct AchievementUnlockListener: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AchievementUnlockListenerMeta.surfaceSlug

    @State private var model: AchievementUnlockListenerModel

    public init(model: AchievementUnlockListenerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production unlock feed — the parity of mounting
    /// `<AchievementUnlockListener />` at the app root. `input` is the host's current snapshot (the SSE
    /// queue + prefs + connectivity); `onView` receives the lifetime deep link when a celebration's
    /// "View" affordance is tapped (web `navigate('/lifetime?achievement=…')`).
    public init(
        input: AchievementUnlockListenerInput,
        config: AchievementUnlockListenerConfig = .default,
        onView: (@MainActor (String) -> Void)? = nil
    ) {
        let source = LiveAchievementUnlockListenerSource(
            status: input.status,
            events: input.events,
            prefs: input.prefs,
            connection: input.connection
        )
        _model = State(initialValue: AchievementUnlockListenerModel(
            source: source,
            config: config,
            chime: AchievementUnlockListenerSystemChime(),
            onView: onView
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                AchievementUnlockListenerFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: model.toasts.first?.id) { previous, current in
            announceArrival(previous: previous, current: current)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            AchievementUnlockListenerLoadingView()
        case .unavailable:
            AchievementUnlockListenerUnavailableView { model.refresh() }
        case let .empty(reason):
            AchievementUnlockListenerEmptyView(reason: reason)
        case .ready:
            AchievementUnlockListenerToastStack(
                toasts: model.toasts,
                onView: { model.view(eventID: $0) },
                onDismiss: { model.dismiss(eventID: $0) }
            )
        }
    }

    /// Posts a polite VoiceOver announcement when a new celebration reaches the head of the stack —
    /// the native parity of the web toast's `role="status"` / `aria-live="polite"` region. Fires only
    /// on a genuinely new head id (not on dismiss-driven changes or the initial empty state).
    private func announceArrival(previous: String?, current: String?) {
        guard let current, current != previous else { return }
        guard let toast = model.toasts.first(where: { $0.id == current }) else { return }
        AccessibilityNotification.Announcement(AttributedString(toast.accessibilityLabel)).post()
    }
}
