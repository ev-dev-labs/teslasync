//
//  RouteTransition.swift
//  TeslaSync — P4 shared surface · 0192 · RouteTransition (Apple)
//
//  The SwiftUI surface — the public API of the route cross-fade wrapper, the parity of the web
//  `components/motion/RouteTransition.tsx`. Wrap it around the routed content (the native parity of the
//  web wrapping `<Outlet />` inside the layout chrome) and feed it the current route `path` from the
//  navigation state holder (P1/S8) — e.g. `selection?.path` off the `AppShell` `NavigationSplitView`
//  selection. The wrapper cross-fades the body whenever `path` changes; the surrounding chrome (sidebar,
//  toolbar) does not animate, exactly as the web component leaves the shell untouched.
//
//  Behaviour (verbatim parity with the web source):
//    • 120 ms ease-out fade + a 4 pt vertical slide — subtle enough to feel polished without slowing the
//      user down (web `useMotionPreference(120)` + `initial/exit y: ±4`).
//    • The first appearance plays no entry animation, so a cold launch does not flash
//      (web `initial={false}`); the model seeds its decision to `.initial`.
//    • Re-keyed by the route `path` only — pass the pathname, not the query/hash, so filter / sort /
//      anchor changes never trigger a re-fade (web keys on `location.pathname`).
//    • Honours reduced motion via `@Environment(\.accessibilityReduceMotion)`: the fade collapses to an
//      instant swap (web `useMotionPreference` → `reduce`).
//    • List ↔ detail navigations (`/drives` ↔ `/drives/:id`, etc.) skip the animation entirely so the
//      drill-in / drill-back-out feels snappy (web `skipForList`).
//
//  The view binds the `RouteTransitionModel` state-holder (P1/S8) for the previous-path ref + the
//  decision + the once-only `view.opened` telemetry (P1/S11); no networking lives here. The cross-fade
//  is composed from native primitives in `RouteTransitionContentLayer` (see RouteTransition.Views.swift).
//

import SwiftUI

// MARK: - RouteTransition (the shared surface)

/// The route cross-fade wrapper — the SwiftUI parity of the web `RouteTransition`. Wraps arbitrary
/// `Content` and cross-fades it on a `path` change, honouring reduced motion and the list ↔ detail skip
/// patterns.
public struct RouteTransition<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        RouteTransitionMeta.surfaceSlug
    }

    @State private var model: RouteTransitionModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let path: String
    private let content: Content

    /// Designated initializer — adopts a fully-formed model (injectable telemetry / seed path for
    /// previews + tests). The model's seed path should equal the initial `path`.
    public init(
        path: String,
        model: RouteTransitionModel,
        @ViewBuilder content: () -> Content
    ) {
        self.path = path
        _model = State(initialValue: model)
        self.content = content()
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<RouteTransition skipPattern={…}>{children}</RouteTransition>`. `path` is the current route
    /// pathname from the navigation state holder; `skipPatterns` defaults to the web
    /// `DEFAULT_SKIP_PATTERNS`.
    public init(
        path: String,
        skipPatterns: [String] = RouteTransitionMeta.defaultSkipPatterns,
        @ViewBuilder content: () -> Content
    ) {
        let input = RouteTransitionInput(initialPath: path, skipPatterns: skipPatterns)
        self.init(path: path, model: RouteTransitionModel(input: input), content: content)
    }

    public var body: some View {
        RouteTransitionContentLayer(
            renderedPath: model.renderedPath,
            decision: model.currentDecision,
            content: content
        )
        .onAppear { model.start() }
        .onChange(of: path) { _, newPath in
            apply(newPath)
        }
    }

    /// Resolves the navigation, then commits it inside the matching transaction — a reduce-motion-aware
    /// ease-out for an `animated` change, or an animation-disabled transaction for the instant swap of a
    /// `suppressed` / `stable` change (web `effectiveDurationMs === 0`).
    private func apply(_ newPath: String) {
        let decision = model.makeDecision(forNext: newPath, reduceMotion: reduceMotion)
        if decision.animates {
            withAnimation(.easeOut(duration: decision.durationSeconds)) {
                model.commit(newPath, decision: decision)
            }
        } else {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                model.commit(newPath, decision: decision)
            }
        }
    }
}
