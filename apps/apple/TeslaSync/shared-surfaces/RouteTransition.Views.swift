//
//  RouteTransition.Views.swift
//  TeslaSync — P4 shared surface · 0192 · RouteTransition (Apple)
//
//  The presentational layer composed by `RouteTransition`: the content host that keys the routed body on
//  the rendered path and applies the cross-fade, plus the `AnyTransition` builder that encodes the web
//  enter / exit geometry. The host is a pure function of the rendered path + the resolved decision, so it
//  renders identically in the live surface, the previews, and the snapshot tests.
//
//  Native composition. SwiftUI plays a transition when a view's identity changes inside an animated
//  transaction, so the host keys `content` on `renderedPath` and the surface advances that path inside
//  the ease-out (or animation-disabled) transaction. The web uses `AnimatePresence mode="wait"` (the
//  outgoing page unmounts before the incoming mounts); SwiftUI cross-dissolves the two layers
//  simultaneously, which produces the same observable 120 ms fade + slide while staying idiomatic — the
//  strict unmount-then-mount ordering is a framer implementation detail, not a HIG expectation. The host
//  fills the available space (web `style={{ minHeight: '100%' }}`) and adds no accessibility semantics of
//  its own, so the routed content keeps its own labels and reading order.
//

import SwiftUI

// MARK: - Content host (keys the body on the rendered path + plays the fade)

/// The routed-body host — keys `content` on `renderedPath` and applies the resolved cross-fade. A
/// `ZStack` gives the inserting + removing layers a stable parent so they cross-dissolve cleanly; the
/// frame fills the available space (web `minHeight: 100%`). `content` is held as a value (the caller
/// already has a `Content`), so the synthesized memberwise initializer is used.
struct RouteTransitionContentLayer<Content: View>: View {
    let renderedPath: String
    let decision: RouteTransitionDecision
    let content: Content

    var body: some View {
        ZStack {
            content
                .id(renderedPath)
                .transition(RouteTransitionGeometry.crossFade(for: decision))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Transition geometry (web enter / exit)

/// Builds the `AnyTransition` for a decision — the native encoding of the web `initial` / `animate` /
/// `exit` variants. An `animated` decision fades while sliding (the incoming page rises from
/// `enterOffsetY` = 4 pt; the outgoing page lifts to `exitOffsetY` = -4 pt); every other decision uses
/// `.identity`, so a reduced-motion / list ↔ detail / first-appearance swap is instant (web
/// `effectiveDurationMs === 0`).
enum RouteTransitionGeometry {
    static func crossFade(for decision: RouteTransitionDecision) -> AnyTransition {
        guard decision.animates else { return .identity }
        return .asymmetric(
            insertion: .offset(y: CGFloat(RouteTransitionMeta.enterOffsetY)).combined(with: .opacity),
            removal: .offset(y: CGFloat(RouteTransitionMeta.exitOffsetY)).combined(with: .opacity)
        )
    }
}
