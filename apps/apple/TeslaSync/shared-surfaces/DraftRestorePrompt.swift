//
//  DraftRestorePrompt.swift
//  TeslaSync — P4 shared surface · 0117 · DraftRestorePrompt (Apple)
//
//  The SwiftUI surface — the public API of the draft-restore prompt, the parity of the web
//  `components/feedback/DraftRestorePrompt.tsx`. The view binds through `DraftRestorePromptModel`
//  (P1/S8) for the surfaced draft index + the once-only `view.opened` telemetry (P1/S11); no networking
//  lives here. Chrome is token-driven (P1/S9) and every string resolves through the P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the index is being read / the cross-tab grace window is open → skeleton card chrome.
//    • empty   — read with no surfaced drafts → friendly empty state (the native improvement over the
//                web rendering nothing), never a blank box.
//    • error   — the index read failed with no cached drafts → a retryable error tile (web `QueryError`
//                peer; the web surface has none).
//    • data    — the bottom-left toast card; "Review" presents the modal listing each draft with Resume
//                / Discard (web `reviewOpen`).
//    • stale / offline — the orthogonal connectivity axis → a freshness chip beneath the card with a
//                one-shot auto-refresh on the stale transition.
//
//  Dismissal parity: once the user dismisses, resumes, or clears the list the transient prompt collapses
//  for the rest of the session (web `writeDismissed` → the component returns `null`). This is the
//  correct behaviour for a user-dismissed transient prompt and is distinct from the data-driven states
//  above, all of which render visibly.
//

import SwiftUI

// MARK: - DraftRestorePrompt (the shared surface)

/// The draft-restore prompt — the SwiftUI parity of `DraftRestorePrompt.tsx`. Renders every data state
/// plus the P4 leaf freshness states, binding through `DraftRestorePromptModel`.
public struct DraftRestorePrompt: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DraftRestorePromptMeta.surfaceSlug

    @State private var model: DraftRestorePromptModel

    /// Designated initializer binding a pre-built model. The host wires the read source (its
    /// `draftIndex` feed + the cross-tab active-key set + the session guard) and the resume navigator.
    public init(model: DraftRestorePromptModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled usage — the parity of mounting `<DraftRestorePrompt />`
    /// globally. Seeds a static source from the supplied index snapshot + connectivity; `onResume` is
    /// the embedder's navigator for a draft's "Resume" affordance (the native peer of react-router
    /// `navigate(entry.route)`).
    public init(
        drafts: [DraftEntry],
        activeKeys: Set<String> = [],
        connection: DraftRestoreConnection = .live,
        status: DraftRestoreLoadStatus? = nil,
        onResume: (@MainActor (DraftEntry) -> Void)? = nil
    ) {
        let resolvedStatus = status ?? (drafts.isEmpty ? .empty : .loaded)
        let update = DraftRestoreUpdate(
            status: resolvedStatus,
            connection: connection,
            drafts: drafts,
            activeKeys: activeKeys
        )
        let source = StaticDraftRestoreSource(update)
        _model = State(initialValue: DraftRestorePromptModel(source: source, onResume: onResume))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                DraftRestoreFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .modifier(DraftRestoreReviewSheet(model: model))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DraftRestoreLoadingView()
        case .empty:
            DraftRestoreEmptyView()
        case let .error(message):
            DraftRestoreErrorView(message: message) { model.refresh() }
        case .data:
            if model.isPromptVisible {
                DraftRestorePromptCard(
                    count: model.drafts.count,
                    onReview: { model.review() },
                    onDismiss: { model.dismiss() }
                )
            }
        }
    }
}

// MARK: - Review sheet (web `Modal`)

/// Attaches the review modal to the surface — the web `Modal` listing every draft with Resume / Discard.
/// Kept as a modifier so the entry body stays readable; bound through the model. Any close path (the
/// container's X, the bottom Close button, or swipe-to-dismiss) routes through `dismiss()`, the parity
/// of the web `Modal onClose={handleDismiss}`.
private struct DraftRestoreReviewSheet: ViewModifier {
    @Bindable var model: DraftRestorePromptModel

    func body(content: Content) -> some View {
        content.tsModal(isPresented: reviewBinding, title: modalTitle) {
            DraftRestoreReviewList(
                drafts: model.drafts,
                onResume: { model.resume($0) },
                onDiscard: { model.discard($0) },
                onClose: { model.dismiss() }
            )
        }
    }

    private var reviewBinding: Binding<Bool> {
        Binding(get: { model.isReviewing }, set: { presented in
            if !presented { model.dismiss() }
        })
    }

    private var modalTitle: LocalizedStringKey {
        LocalizedStringKey(DraftRestoreStrings.string("draft.recovery.modalTitle", "Restore unsaved drafts"))
    }
}
