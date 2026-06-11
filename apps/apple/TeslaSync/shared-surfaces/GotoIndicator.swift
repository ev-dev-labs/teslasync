//
//  GotoIndicator.swift
//  TeslaSync — P4 shared surface · 0121 · GotoIndicator (Apple)
//
//  The SwiftUI surface — the public API of the goto indicator, the parity of the web
//  `components/feedback/GotoIndicator.tsx`. The view binds through `GotoIndicatorModel` (P1/S8) for the
//  resolved hint + the once-only `view.opened` telemetry (P1/S11); no networking lives here. Chrome is
//  token-driven (P1/S9) and every string resolves through the P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the shortcut controller is being read → skeleton chord chrome.
//    • empty   — the chord is not pending (web `if (!visible) return null`) → friendly empty state (the
//                native improvement over the web component rendering nothing), never a blank box.
//    • error   — the controller read failed with no known visibility → a retryable error tile (web
//                `QueryError` peer).
//    • data    — the floating "Go to…" hint with the `g` / `?` key caps (web `<kbd>` chord).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the hint with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - GotoIndicator (the shared surface)

/// The goto indicator — the SwiftUI parity of the web `GotoIndicator`. Renders every state plus the P4
/// leaf freshness states, binding through `GotoIndicatorModel`.
public struct GotoIndicator: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = GotoIndicatorSurface.slug

    @State private var model: GotoIndicatorModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: GotoIndicatorModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled-prop usage — the parity of the web parent mounting
    /// `<GotoIndicator visible={…} />`.
    public init(visible: Bool, connection: GotoConnection = .live) {
        let source = StaticGotoIndicatorSource(visible: visible, connection: connection)
        _model = State(initialValue: GotoIndicatorModel(source: source))
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            content
                .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: isDataPhase)
            if model.connection != .live {
                GotoFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// Whether the surface is showing the floating hint — the animation key that drives the pill's
    /// Reduce-Motion-aware slide-in / fade-in entrance (web `slide-in-from-bottom + fade-in`).
    private var isDataPhase: Bool {
        if case .data = model.phase { return true }
        return false
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            GotoLoadingView()
        case .empty:
            GotoEmptyView()
        case let .error(message):
            GotoErrorView(message: message) { model.refresh() }
        case .data:
            if let hint = model.hint {
                GotoHintView(hint: hint)
            }
        }
    }
}
