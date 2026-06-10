//
//  QueueJobDrawer.swift
//  TeslaSync — P4 modal / dialog · 0020 · QueueJobDrawer (Apple)
//
//  The per-worker job-history drawer — the SwiftUI parity of
//  features/admin/components/QueueJobDrawer.tsx. Reproduces the web composition + behaviour with
//  platform primitives (no Tailwind / framer-motion ported): an edge-anchored glass panel over a
//  tap-to-dismiss scrim, sliding in from the trailing edge with a Reduce-Motion-safe transition; a
//  titled header (web always passes a `title`) with a close "×"; and a scrollable body that
//  switches over the model's resolved phase so every prompt-required state renders (loading /
//  empty / error / list, with the stale + offline banner) — never a blank box. Binds through
//  `QueueJobDrawerModel` (P1/S8); no HTTP lives here.
//
//  Dismissal (web `onClose`) is one path shared by the scrim tap, the close button, and the
//  Escape / VoiceOver-escape gesture. Presentation marks the panel `.isModal` (muting the
//  background to assistive tech) and moves VoiceOver focus onto it (web "focus the first
//  focusable" on open).
//

import SwiftUI

/// The per-worker job-history drawer, binding through `QueueJobDrawerModel` (P1/S8). The host
/// mounts it when open (web `open`) and unmounts on dismissal (web `onClose`).
public struct QueueJobDrawer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = QueueJobDrawerSurface.slug

    @State private var model: QueueJobDrawerModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AccessibilityFocusState private var panelFocused: Bool

    public init(model: QueueJobDrawerModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack(alignment: .trailing) {
            QueueJobDrawerScrim(onTap: model.dismiss)
            panel
                .transition(panelTransition)
        }
        .onAppear {
            model.start()
            panelFocused = true
        }
        .onDisappear { model.stop() }
    }

    /// The trailing-anchored glass panel: the titled header, the optional stale / offline banner,
    /// and the phase-switched body — capped at the web `max-w-md` width and filling the height.
    private var panel: some View {
        VStack(spacing: TSSpacing.none) {
            QueueJobDrawerHeader(
                title: model.title,
                connection: model.connection,
                closeLabel: model.closeAccessibilityLabel,
                onClose: model.dismiss
            )
            Divider().overlay(Color.TS.border)
            scrollBody
        }
        .frame(maxWidth: 448, maxHeight: .infinity, alignment: .top)
        .background(.regularMaterial)
        .overlay(alignment: .leading) {
            Rectangle().fill(Color.TS.border).frame(width: 1).ignoresSafeArea()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.panelAccessibilityLabel))
        .accessibilityAddTraits(.isModal)
        .accessibilityFocused($panelFocused)
        .accessibilityAction(.escape, model.dismiss)
    }

    /// The scrollable region (web `flex-1 overflow-y-auto p-6`): the stale / offline banner (when
    /// not live) pinned above the phase body.
    private var scrollBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if model.connection != .live {
                    QueueJobDrawerConnectivityBanner(connection: model.connection)
                }
                body(for: model.phase)
            }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
    }

    /// The body envelope: every state renders real chrome (web `isLoading ? … : error ? … :
    /// empty ? … : list`, widened into the prompt's loading / empty / error / list states).
    @ViewBuilder
    private func body(for phase: QueueJobDrawerPhase) -> some View {
        switch phase {
        case .loading:
            QueueJobDrawerLoadingState()
        case .empty:
            QueueJobDrawerEmptyState()
        case let .error(message):
            QueueJobDrawerErrorState(message: message) { model.refresh() }
        case .populated:
            QueueJobDrawerList(model: model)
        }
    }

    /// The slide-in transition from the trailing edge, combined with a fade; under Reduce Motion
    /// it degrades to a plain fade (web framer-motion spring → native, motion-safe).
    private var panelTransition: AnyTransition {
        if reduceMotion {
            return .opacity
        }
        return .move(edge: .trailing).combined(with: .opacity)
    }
}
