//
//  SessionExpiringModal.swift
//  TeslaSync — P4 modal / dialog · 0009 · SessionExpiringModal (Apple)
//
//  The session-expiring warning dialog — the SwiftUI parity of
//  components/feedback/SessionExpiringModal.tsx. The web source is a soft-blocking `Modal` that
//  pops ~60s before the upstream ForwardAuth cookie expires with a live countdown, an optional
//  list of unsaved drafts that a forced sign-out would strand, and two affordances ("Stay signed
//  in" → re-poll/renew, "Sign out now" → IdP handoff). It renders nothing in open mode or when
//  not near expiry. The native surface switches over the model's resolved `visibility` so that
//  early-return is reproduced (hidden vs the presented panel, faded in), and the presented panel
//  switches over the body phase so every prompt-required state renders (loading / empty / error /
//  content) — never a blank box. All data + presentation lives in `SessionExpiringModel` (P1/S8);
//  no networking or persistence here.
//

import SwiftUI

/// The session-expiring warning dialog, binding through `SessionExpiringModel` (P1/S8).
public struct SessionExpiringModal: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SessionExpiringSurface.slug

    @State private var model: SessionExpiringModel

    public init(model: SessionExpiringModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The web early-return resolved to a rendered surface: nothing while hidden (web `null`), else
    /// the presented panel faded in (web `Modal` content).
    @ViewBuilder
    private var content: some View {
        switch model.visibility {
        case .hidden:
            EmptyView()
        case .presented:
            TSFadeIn(delay: 0.05) {
                SessionExpiringPanel(model: model)
            }
        }
    }
}
