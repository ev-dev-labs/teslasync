//
//  PageHeaderSticky.swift
//  TeslaSync — P4 shared surface · 0172 · PageHeaderSticky (Apple)
//
//  The SwiftUI surface — the parity of components/layout/PageHeaderSticky.tsx. The web component is an
//  `IntersectionObserver`-driven sticky bar dropped into a page after the hero card: it observes a target
//  element by id and, once that target scrolls above the top of the scroll viewport, pins a compressed
//  summary bar at `top: topOffset` (optionally a click-to-scroll-to-top button). It owns no scroll
//  container of its own (it observes `#main-content`).
//
//  The idiomatic SwiftUI mapping is a view modifier applied to the page's `ScrollView`, plus a
//  `.pageHeaderStickyTarget()` marker on the hero:
//
//    • .pageHeaderStickyTarget() — the parity of the web `id={targetId}` anchor. It reports the hero's
//      frame in the scroll viewport's coordinate space through a `PreferenceKey`, so the bar binds to its
//      anchor STRUCTURALLY (within the same scroll container) rather than via a global DOM id lookup.
//    • .pageHeaderSticky(targetID:ariaLabel:…) { summary } — the parity of `<PageHeaderSticky>`. Applied
//      to the `ScrollView`, it feeds the anchor frame + the viewport height into a
//      ``PageHeaderStickyModel``, and renders the resolved bar through `safeAreaInset(edge: .top)` — the
//      canonical SwiftUI "sticky header" (`position: sticky`), honoring `topOffset` and keeping content
//      reachable. The whole bar is a scroll-to-top button (web default) that drives
//      `ScrollPosition.scrollTo(edge: .top)` (the native peer of the web `#main-content` smooth scroll),
//      reduce-motion aware.
//
//  No networking, no Tailwind ports, no raw hex — chrome is token-driven (P1/S9) and copy resolves
//  through P1/S10. The bar chrome itself lives in PageHeaderSticky.Views.swift; the visibility decision is
//  the pure ``PageHeaderStickyVisibility`` in the Adapter.
//

import SwiftUI

// MARK: - Anchor frame plumbing (web `targetId` + IntersectionObserver geometry)

/// The hero anchor's frame in the scroll viewport's coordinate space — the native peer of the
/// `IntersectionObserver` entry's `boundingClientRect` top + bottom (y = 0 is the visible top).
struct PageHeaderStickyTargetFrame: Equatable {
    var top: CGFloat
    var bottom: CGFloat
}

/// Bubbles the hero anchor's viewport-space frame up to the sticky modifier — the parity of the web
/// observer reading `entry.boundingClientRect` for the element with `id={targetId}`.
private struct PageHeaderStickyTargetFrameKey: PreferenceKey {
    static let defaultValue: PageHeaderStickyTargetFrame? = nil
    static func reduce(
        value: inout PageHeaderStickyTargetFrame?,
        nextValue: () -> PageHeaderStickyTargetFrame?
    ) {
        value = nextValue() ?? value
    }
}

// MARK: - PageHeaderStickyModifier (web `<PageHeaderSticky>`)

/// The sticky-bar modifier — the parity of `<PageHeaderSticky>`. Applied to a `ScrollView`, it tracks the
/// anchor's viewport-space frame (via the ``PageHeaderStickyTargetFrameKey`` preference) and the visible
/// viewport height (via `onScrollGeometryChange`), feeds both to a ``PageHeaderStickyModel`` (which runs
/// the pure visibility decision), and renders the resolved bar in a top `safeAreaInset`. Scroll-to-top
/// drives `ScrollPosition.scrollTo(edge: .top)`, reduce-motion aware.
public struct PageHeaderStickyModifier<Summary: View>: ViewModifier {
    @State private var model: PageHeaderStickyModel
    @State private var scrollPosition = ScrollPosition(edge: .top)
    @State private var viewportHeight: CGFloat = 0
    @State private var targetFrame: PageHeaderStickyTargetFrame?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let summary: Summary

    /// Production initializer — builds the model from the config (web props).
    public init(config: PageHeaderStickyConfig, @ViewBuilder summary: () -> Summary) {
        _model = State(initialValue: PageHeaderStickyModel(config: config))
        self.summary = summary()
    }

    /// Model-injecting initializer — used by previews + tests that drive a spy telemetry / fixed config.
    public init(model: PageHeaderStickyModel, @ViewBuilder summary: () -> Summary) {
        _model = State(initialValue: model)
        self.summary = summary()
    }

    public func body(content: Content) -> some View {
        content
            .scrollPosition($scrollPosition)
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                geometry.containerSize.height
            } action: { _, height in
                viewportHeight = height
            }
            .onPreferenceChange(PageHeaderStickyTargetFrameKey.self) { frame in
                targetFrame = frame
            }
            .onChange(of: viewportHeight) { pushGeometry() }
            .onChange(of: targetFrame) { pushGeometry() }
            .safeAreaInset(edge: .top, spacing: 0) { stickyBar }
            .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.presentation.isVisible)
            .onAppear { model.start() }
    }

    /// The top-pinned bar, rendered only while visible — the parity of `if (!visible) return null`. When
    /// hidden the inset collapses to nothing, so it claims no space until the hero scrolls past.
    @ViewBuilder
    private var stickyBar: some View {
        if model.presentation.isVisible {
            PageHeaderStickyBar(presentation: model.presentation, onScrollToTop: scrollToTop) {
                summary
            }
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    /// Combines the latest anchor frame + viewport height into one ``PageHeaderStickyGeometry`` and hands
    /// it to the model — the native peer of one `IntersectionObserver` callback tick. Skips until both the
    /// anchor frame and a real viewport height are known (the bar starts hidden, web `useState(false)`).
    private func pushGeometry() {
        guard let targetFrame, viewportHeight > 0 else { return }
        model.updateGeometry(
            PageHeaderStickyGeometry(
                targetTop: targetFrame.top,
                targetBottom: targetFrame.bottom,
                viewportHeight: viewportHeight
            )
        )
    }

    /// Scrolls the page back to the top — the native peer of the web `#main-content` smooth scroll. Honors
    /// Reduce Motion (an instant jump when motion is reduced).
    private func scrollToTop() {
        withAnimation(TSAnimation.standard(reduceMotion: reduceMotion)) {
            scrollPosition.scrollTo(edge: .top)
        }
    }
}

// MARK: - Ergonomic entry points (web `<PageHeaderSticky>` + `id={targetId}`)

public extension View {
    /// Marks this view as the sticky bar's anchor — the parity of the web `id={targetId}` on the page
    /// hero. The bar appears once this view scrolls above the top of the scroll viewport. Place it on the
    /// page-level overview card inside the same `ScrollView` carrying
    /// ``pageHeaderSticky(targetID:ariaLabel:scrollToTop:topOffset:testID:summary:)``.
    func pageHeaderStickyTarget() -> some View {
        background(
            GeometryReader { proxy in
                Color.clear.preference(
                    key: PageHeaderStickyTargetFrameKey.self,
                    value: PageHeaderStickyTargetFrame(
                        top: proxy.frame(in: .scrollView(axis: .vertical)).minY,
                        bottom: proxy.frame(in: .scrollView(axis: .vertical)).maxY
                    )
                )
            }
        )
    }

    /// Attaches a sticky page-header bar to this `ScrollView` — the parity of `<PageHeaderSticky>`. The
    /// bar stays hidden until the ``pageHeaderStickyTarget()`` anchor scrolls above the top, then pins a
    /// compressed `summary` at `topOffset`. By default the whole bar is a scroll-to-top button.
    func pageHeaderSticky(
        targetID: String,
        ariaLabel: String,
        scrollToTop: Bool = true,
        topOffset: CGFloat = 0,
        testID: String? = nil,
        @ViewBuilder summary: () -> some View
    ) -> some View {
        modifier(
            PageHeaderStickyModifier(
                config: PageHeaderStickyConfig(
                    targetID: targetID,
                    ariaLabel: ariaLabel,
                    scrollToTop: scrollToTop,
                    topOffset: topOffset,
                    testID: testID
                ),
                summary: summary
            )
        )
    }

    /// Attaches a sticky bar from a pre-built model — the previews / tests entry point.
    func pageHeaderSticky(
        model: PageHeaderStickyModel,
        @ViewBuilder summary: () -> some View
    ) -> some View {
        modifier(PageHeaderStickyModifier(model: model, summary: summary))
    }
}
