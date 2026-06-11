//
//  ChangelogModal.swift
//  TeslaSync — P4 modal / dialog · 0003 · ChangelogModal (Apple)
//
//  The changelog dialog — the SwiftUI parity of components/feedback/ChangelogModal.tsx. The web source is
//  a `Modal` (size lg) titled "What's new in TeslaSync" with a first-visit / since-last-visit subtitle, a
//  scrolling list of collapsible release entries (version + Latest/Stable/Beta badge + date, body grouped
//  by Keep-a-Changelog category), and a footer with "View full changelog" (opens the GitHub releases page)
//  and "Got it" (marks the latest version seen). The native surface reproduces that exactly as HIG sheet
//  content: a pinned header (title + freshness chip + close), then the body switched over the model's
//  resolved phase so every prompt-required state renders (loading / empty / error / populated, plus the
//  stale / offline freshness banners) — never a blank box. Binds through `ChangelogModel` (P1/S8); no
//  networking or persistence lives here. Designed to be presented in a `.sheet`; the view owns dismissal,
//  the model owns the seen / view-full seams.
//

import SwiftUI

/// The changelog surface, binding through `ChangelogModel` (P1/S8). Presented in a sheet by a host; the
/// header Close (web `onClose`) dismisses without marking seen, "Got it" (web `handleGotIt`) marks the
/// latest version seen then dismisses, and "View full changelog" (web `handleViewFull`) marks seen, opens
/// the releases page, then dismisses.
public struct ChangelogModal: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ChangelogSurface.slug

    @State private var model: ChangelogModel
    @Environment(\.dismiss) private var dismiss

    public init(model: ChangelogModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            ChangelogHeader(model: model, onClose: closeModal)
            Divider().overlay(Color.TS.border)
            body(for: model.phase)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
    }

    /// The body under the header: the populated list for `.populated`, else the loading / empty / error
    /// envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: ChangelogPhase) -> some View {
        switch phase {
        case .loading:
            ChangelogLoadingState()
        case .empty:
            ChangelogEmptyState()
        case let .error(message):
            ChangelogErrorState(message: message) { model.refresh() }
        case .populated:
            ChangelogPopulatedView(model: model, onGotIt: gotIt, onViewFull: viewFull)
        }
    }

    /// Web `onClose` — record the dismiss intent (leaves the seen-state untouched), then dismiss.
    private func closeModal() {
        model.close()
        dismiss()
    }

    /// Web `handleGotIt` — mark the latest version seen, then dismiss the sheet.
    private func gotIt() {
        model.gotIt()
        dismiss()
    }

    /// Web `handleViewFull` — mark seen + open the releases page, then dismiss the sheet.
    private func viewFull() {
        model.viewFull()
        dismiss()
    }
}
