//
//  SuspenseProgressBoundary.swift
//  TeslaSync — P4 shared surface · 0141 · SuspenseProgressBoundary (Apple)
//
//  The SwiftUI parity of `components/feedback/SuspenseProgressBoundary.tsx`: a 1:1 wrapper that renders a
//  `fallback` while its child is loading and the real `content` once it resolves, bridging the loading
//  window to the shared progress controller so every lazy boundary gets a visible progress affordance
//  without each call-site wiring its own loader. The view binds the `SuspenseProgressBoundaryModel`
//  state-holder (P1/S8) for the phase + the once-only `view.opened` telemetry (P1/S11); no networking
//  lives in the view (the web source has none — readiness is supplied by the host, the parity of
//  `<Suspense>` resolving its lazy child).
//
//  Where the web `<Suspense>` discovers suspension implicitly from a thrown promise, SwiftUI has no
//  render-time suspension primitive, so readiness is an explicit `isReady` flag the host flips when its
//  lazy / async child is ready (e.g. a `LoadableState` reaching `.loaded`). The bridge semantics are
//  identical: fallback mounted ⇒ controller active; children rendered ⇒ controller idle.
//

import SwiftUI

/// The suspense → progress boundary — the SwiftUI parity of the web `SuspenseProgressBoundary`. Shows
/// `fallback` while `isReady` is `false` and `content` once it turns `true`, holding the shared progress
/// controller active for the loading window and emitting `view.opened` once on first appearance.
public struct SuspenseProgressBoundary<Content: View, Fallback: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SuspenseProgressBoundaryMeta.surfaceSlug
    }

    private let isReady: Bool
    private let showsProgressBar: Bool
    private let content: () -> Content
    private let fallback: () -> Fallback
    @State private var model: SuspenseProgressBoundaryModel

    /// Designated initializer — adopts the host's readiness flag, whether the boundary overlays its own
    /// progress bar, the shared (or an injected) progress controller, and an injectable telemetry sink
    /// (the production `os.Logger` default, a spy in tests). `content` is the resolved child (web
    /// `children`); `fallback` is shown while loading (web `fallback`).
    public init(
        isReady: Bool,
        showsProgressBar: Bool = true,
        controller: SuspenseProgressController = .shared,
        telemetry: any SuspenseProgressBoundaryTelemetry = OSLogSuspenseProgressBoundaryTelemetry(),
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder fallback: @escaping () -> Fallback
    ) {
        self.isReady = isReady
        self.showsProgressBar = showsProgressBar
        self.content = content
        self.fallback = fallback
        _model = State(
            initialValue: SuspenseProgressBoundaryModel(
                isReady: isReady,
                controller: controller,
                telemetry: telemetry
            )
        )
    }

    public var body: some View {
        SuspenseBoundaryContainer(
            phase: model.phase,
            showsProgressBar: showsProgressBar,
            controller: model.controller,
            content: content,
            fallback: fallback
        )
        .onAppear { model.start() }
        .onChange(of: isReady) { _, newValue in model.sync(isReady: newValue) }
        .onDisappear { model.stop() }
    }
}
