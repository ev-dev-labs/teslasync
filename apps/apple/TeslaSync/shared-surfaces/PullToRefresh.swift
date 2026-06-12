//
//  PullToRefresh.swift
//  TeslaSync — P4 shared surface · 0188 · PullToRefresh (Apple)
//
//  The SwiftUI surface — the public API of the pull-to-refresh wrapper, the parity of the web
//  `components/mobile/PullToRefresh.tsx`. The view binds through `PullToRefreshModel` (P1/S8) for the
//  gesture state machine + the once-only `view.opened` telemetry (P1/S11); no networking lives here.
//  Chrome is token-driven (P1/S9) and every string resolves through the P1/S10 facade.
//
//  Composition. On a fine-pointer platform (the Mac) the surface renders `children` straight through —
//  no scroll wrapper, no gesture, no indicator — exactly as the web returns `<>{children}</>` when
//  `!active`. On a coarse-pointer platform (iPhone / iPad) it wraps the content in a `ScrollView`,
//  floats the `PullToRefreshIndicator` over the top, and drives the pull from a `DragGesture` gated to
//  the scroll-top (the native parity of the web touch listeners gating on `isAtScrollTop`):
//    • during a drag the content tracks the finger 1:1 (no animation), the parity of the web having no
//      transition while `pull > 0`;
//    • on release the content snaps back with a Reduce-Motion-aware ease (web's `150 ms` settle), and a
//      release past the threshold awaits `onRefresh` behind the refreshing indicator.
//  A native VoiceOver "Refresh" action triggers the same refresh without the drag, since the pull
//  gesture has no assistive equivalent in the web source.
//

import SwiftUI

// MARK: - PullToRefresh (the shared surface)

/// The pull-to-refresh wrapper — the SwiftUI parity of the web `PullToRefresh`. Wraps arbitrary
/// `Content`; touch platforms get the pull gesture + indicator, pointer platforms get a transparent
/// pass-through.
public struct PullToRefresh<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        PullToRefreshMeta.surfaceSlug
    }

    @State private var model: PullToRefreshModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let content: Content

    /// Threshold below which the scroll view is considered "at the top" (web `scrollTop <= 0`).
    private let topEpsilon: CGFloat = 0.5

    /// Designated initializer — adopts a fully-formed model (injectable pointer / telemetry / strings
    /// for previews + tests).
    public init(model: PullToRefreshModel, @ViewBuilder content: () -> Content) {
        _model = State(initialValue: model)
        self.content = content()
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<PullToRefresh onRefresh={…} threshold={…} enabled={…}>{children}</PullToRefresh>`. The pointer
    /// capability resolves to the platform default (touch on iOS / iPadOS, pointer on macOS).
    public init(
        threshold: Double = PullToRefreshMeta.defaultThreshold,
        enabled: Bool? = nil,
        onRefresh: @escaping @MainActor () async -> Void,
        @ViewBuilder content: () -> Content
    ) {
        let input = PullToRefreshInput(threshold: threshold, pointer: .platformDefault, enabled: enabled)
        _model = State(initialValue: PullToRefreshModel(input: input, onRefresh: onRefresh))
        self.content = content()
    }

    public var body: some View {
        if model.active {
            activeBody
        } else {
            // Web: `if (!active) return <>{children}</>` — no wrapper, no listeners.
            content
        }
    }

    // MARK: Active (coarse-pointer) body

    private var activeBody: some View {
        ScrollView(.vertical) {
            content
                .frame(maxWidth: .infinity)
                .offset(y: model.contentOffset)
        }
        .overlay(alignment: .top) { indicatorOverlay }
        .animation(snapBack, value: model.refreshing)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y <= topEpsilon
        } action: { _, atTop in
            model.setAtTop(atTop)
        }
        .simultaneousGesture(pullGesture)
        .accessibilityElement(children: .contain)
        .accessibilityHint(Text(verbatim: model.hintLabel))
        .accessibilityAction(named: Text(verbatim: model.actionLabel)) {
            model.triggerRefresh()
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var indicatorOverlay: some View {
        if model.phase.showsIndicator {
            PullToRefreshIndicator(
                pull: model.pull,
                refreshing: model.refreshing,
                threshold: model.threshold
            )
            .frame(maxWidth: .infinity)
            .frame(height: model.indicatorHeight, alignment: .bottom)
            .clipped()
            .allowsHitTesting(false)
        }
    }

    // MARK: Gesture + motion

    private var pullGesture: some Gesture {
        DragGesture(minimumDistance: PullToRefreshMeta.moveGuard, coordinateSpace: .local)
            .onChanged { value in
                model.dragChanged(translationHeight: value.translation.height)
            }
            .onEnded { _ in
                withAnimation(snapBack) {
                    model.dragEnded()
                }
            }
    }

    /// The snap-back / settle animation — a fast token ease, collapsed to an instant change under
    /// Reduce Motion (web `reduce` → no transition).
    private var snapBack: Animation? {
        reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration)
    }
}
