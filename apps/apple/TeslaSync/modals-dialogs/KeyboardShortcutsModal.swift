//
//  KeyboardShortcutsModal.swift
//  TeslaSync — P4 modal/dialog · 0006 · KeyboardShortcutsModal (Apple)
//
//  The keyboard-shortcuts cheat sheet — the SwiftUI parity of
//  web/src/components/feedback/KeyboardShortcutsModal.tsx. The web source is a `Modal` whose body is a
//  `SearchInput`, an All / Global / This page filter (`role="tablist"`), and a scrolling list of grouped
//  shortcut rows (description + key chips), with a "No shortcuts match your search." empty line. The
//  native surface presents that same composition as HIG sheet content (web `Modal` → native sheet): it
//  fades in inside a `TSGlassPanel`, shows the title + freshness chip + close, surfaces a cached-data
//  banner when the bound live-state is not fresh, and switches over the model's resolved phase so every
//  prompt-required state renders (loading / empty / error / content) — never a blank box. Binds through
//  `KBShortcutsModel` (P1/S8); no store reads or navigation live here.
//
//  Dismissal mirrors the web `Modal`: the close "×" routes to `onClose` through the injected
//  `KBShortcutsController`, and closing also clears the live search box (web `useEffect` on `open`). The
//  presenting host observes the controller and dismisses around this surface.
//

import SwiftUI

/// The cheat-sheet surface, binding through `KBShortcutsModel` (P1/S8). Searching + filtering happen in
/// the model; the close "×" dismisses through the controller and clears the search box.
public struct KeyboardShortcutsModal: View {
    @State private var model: KBShortcutsModel

    public init(model: KBShortcutsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    KBShortcutHeader(
                        title: model.title,
                        connection: model.connection,
                        closeLabel: model.closeAccessibilityLabel,
                        onClose: handleClose
                    )
                    if model.connection != .live {
                        KBShortcutConnectivityBanner(connection: model.connection)
                    }
                    KBShortcutControls(model: model)
                    body(for: model.phase)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear(perform: handleDisappear)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web modal body under the controls: the grouped list for `.content`, else the loading / empty /
    /// error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: KBShortcutsPhase) -> some View {
        switch phase {
        case .loading:
            KBShortcutLoadingState()
        case .empty:
            KBShortcutEmptyState(message: model.emptyMessage)
        case let .error(message):
            KBShortcutErrorState(message: message) { model.refresh() }
        case .content:
            KBShortcutList(model: model)
        }
    }

    /// Close-with-dismiss (web `onClose`): routes through the controller; the host tears down the sheet.
    private func handleClose() {
        model.dismiss()
    }

    /// On teardown the live search box is cleared (web `useEffect` reset on close) and the feed is stopped.
    private func handleDisappear() {
        model.resetSearch()
        model.stop()
    }
}

// MARK: - Surface identity

public extension KeyboardShortcutsModal {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        KBShortcutsSurface.slug
    }
}
