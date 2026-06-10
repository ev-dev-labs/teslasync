//
//  SessionExpiredModal.swift
//  TeslaSync — P4 modal/dialog · 0008 · SessionExpiredModal (Apple)
//
//  The session-expired hard block — the SwiftUI parity of components/feedback/SessionExpiredModal.tsx.
//  The web source reads `useSessionMonitor()` for `{ mode, hasExpired }`, latches a
//  `teslasync:session-expired` document event, suppresses itself in open mode, and otherwise opens a
//  non-dismissible Modal (`open = hasExpired || eventTriggered`) whose only action — "Sign in again"
//  — hands off to `navigateToReauth`. The native surface presents that as HIG panel content: it
//  fades in inside a `TSGlassPanel`, shows a freshness chip when the verdict is not live, and
//  switches over the model's resolved phase so every prompt-required state renders (loading / empty
//  / dormant / expired / error) — never a blank box. Binds through `SessionExpiredModel` (P1/S8); no
//  network and no navigation live here, and there is no dismiss affordance (web Esc/backdrop no-op).
//

import SwiftUI

/// The session-expired surface, binding through `SessionExpiredModel` (P1/S8). The block is
/// non-dismissible: the only exit is the "Sign in again" action, which hands off to the re-auth
/// controller (web `navigateToReauth`). A host consults `model.isBlocking` to decide whether to
/// actually present the overlay; rendered directly, the surface always shows an informative state.
public struct SessionExpiredModal: View {
    @State private var model: SessionExpiredModel

    public init(model: SessionExpiredModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    if model.connection != .live {
                        HStack(spacing: TSSpacing.sm) {
                            Spacer(minLength: TSSpacing.sm)
                            SessionExpiredFreshnessChip(connection: model.connection)
                        }
                    }
                    body(for: model.phase)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The body under the (conditional) freshness chip: the expired hard block for `.expired`, else
    /// the loading / empty / dormant / error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: SessionExpiredPhase) -> some View {
        switch phase {
        case .loading:
            SessionExpiredLoadingState()
        case .empty:
            SessionExpiredEmptyState()
        case .dormant:
            SessionExpiredDormantState()
        case .expired:
            SessionExpiredBlock(connection: model.connection, onSignIn: handleSignIn)
        case let .error(message):
            SessionExpiredErrorState(message: message) { model.refresh() }
        }
    }

    /// The web `handleSignIn` → `navigateToReauth()` handoff.
    private func handleSignIn() {
        model.signIn()
    }
}

// MARK: - Surface identity

public extension SessionExpiredModal {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SessionExpiredSurface.slug
    }
}
