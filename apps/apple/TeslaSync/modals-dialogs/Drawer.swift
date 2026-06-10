//
//  Drawer.swift
//  TeslaSync — P4 modal / dialog · 0013 · Drawer (Apple)
//
//  The slide-in side panel — the SwiftUI parity of components/ui/Drawer.tsx. Reproduces the web
//  composition + behaviour with platform primitives (no Tailwind / framer-motion ported): an edge-
//  anchored glass panel over a tap-to-dismiss scrim, sliding in from the side with a Reduce-Motion-safe
//  spring; a titled header (only when a title is set, web `title && <header/>`) with a close "×"; a
//  scrollable body that switches over the model's resolved phase so every prompt-required state renders
//  (loading / empty / error / content, with the stale + offline banner) — never a blank box; and an
//  optional footer. Binds through `DrawerModel` (P1/S8); no HTTP lives here.
//
//  Dismissal (web `onClose`) is one path shared by the scrim tap, the close button, the footer Done,
//  and the Escape / VoiceOver-escape gesture. Presentation marks the panel `.isModal` (muting the
//  background to assistive tech) and moves VoiceOver focus onto it (web "focus the first focusable").
//

import SwiftUI

/// The slide-in side panel, binding through `DrawerModel` (P1/S8). The host mounts it when open (web
/// `open`) and unmounts on dismissal (web `onClose`).
public struct Drawer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DrawerSurface.slug

    @State private var model: DrawerModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AccessibilityFocusState private var panelFocused: Bool

    public init(model: DrawerModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack(alignment: model.edge.alignment) {
            DrawerScrim(onTap: model.dismiss)
            panel
                .transition(panelTransition)
        }
        .onAppear {
            model.start()
            panelFocused = true
        }
        .onDisappear { model.stop() }
    }

    /// The edge-anchored glass panel: header (optional), the phase-switched body, and the footer
    /// (optional), capped at the web `max-w-md` width and filling the height.
    private var panel: some View {
        VStack(spacing: TSSpacing.none) {
            if let title = model.title {
                DrawerHeader(
                    title: title,
                    connection: model.connection,
                    closeLabel: model.closeAccessibilityLabel,
                    onClose: model.dismiss
                )
                Divider().overlay(Color.TS.border)
            }
            scrollBody
            if model.showsFooter {
                DrawerFooter(
                    countSummary: model.countSummary,
                    doneLabel: DrawerStrings.string("drawer.done", "Done"),
                    onDone: model.dismiss
                )
            }
        }
        .frame(maxWidth: 448, maxHeight: .infinity, alignment: .top)
        .background(.regularMaterial)
        .overlay(alignment: model.edge.borderAlignment) {
            Rectangle().fill(Color.TS.border).frame(width: 1).ignoresSafeArea()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.dialogLabel))
        .accessibilityValue(Text(verbatim: model.accessibilitySummary))
        .accessibilityAddTraits(.isModal)
        .accessibilityFocused($panelFocused)
        .accessibilityAction(.escape, model.dismiss)
    }

    /// The scrollable region: the stale / offline banner (when not live) pinned above the phase body.
    private var scrollBody: some View {
        ScrollView {
            VStack(spacing: TSSpacing.none) {
                if model.connection != .live {
                    DrawerConnectivityBanner(connection: model.connection)
                }
                body(for: model.phase)
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// The body envelope: every state renders real chrome (web children widened into the prompt's
    /// loading / empty / error / content states).
    @ViewBuilder
    private func body(for phase: DrawerPhase) -> some View {
        switch phase {
        case .loading:
            DrawerLoadingBody()
        case .empty:
            DrawerEmptyBody(message: model.emptyMessage)
        case let .error(message):
            DrawerErrorBody(
                message: message,
                retryLabel: DrawerStrings.string("drawer.retry", "Retry"),
                onRetry: model.retry
            )
        case .content:
            DrawerContentBody(items: model.items)
        }
    }

    /// The slide-in transition from the model's edge, combined with a fade; under Reduce Motion it
    /// degrades to a plain fade (web framer-motion spring → native, motion-safe).
    private var panelTransition: AnyTransition {
        if reduceMotion {
            return .opacity
        }
        return .move(edge: model.edge.swiftUIEdge).combined(with: .opacity)
    }
}

// MARK: - Edge → SwiftUI geometry

extension DrawerEdge {
    /// The container alignment that anchors the panel to this edge.
    var alignment: Alignment {
        self == .trailing ? .trailing : .leading
    }

    /// The SwiftUI edge the panel slides from (web `x: '100%' | '-100%'`).
    var swiftUIEdge: Edge {
        self == .trailing ? .trailing : .leading
    }

    /// The alignment for the panel's inner separating border (web `border-l` / `border-r`).
    var borderAlignment: Alignment {
        self == .trailing ? .leading : .trailing
    }
}
