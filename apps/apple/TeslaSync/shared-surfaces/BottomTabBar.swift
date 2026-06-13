//
//  BottomTabBar.swift
//  TeslaSync — P4 shared surface · 0165 · BottomTabBar (Apple)
//
//  The public API of the bottom tab bar — the SwiftUI parity of `components/layout/BottomTabBar.tsx`. Like the
//  web component it is driven by its route (web `useLocation().pathname`) and renders a fixed row of tabs, one
//  of which is highlighted as active; navigation is forwarded through `onNavigate` (the native peer of the web
//  `<PrefetchLink to=>`). The view binds through ``BottomTabBarModel`` for the resolved projection + the
//  once-only `view.opened` telemetry (P1/S11), composes the token-driven chrome (P1/S9) — a material backing
//  with a hairline top border (web `backdrop-blur-xl border-t`) — honors Reduce Motion at the active-tab
//  transition, and pushes route changes into the holder via `.onChange` so the highlight tracks navigation. No
//  networking, no Tailwind ports.
//

import SwiftUI

/// The bottom tab bar — the SwiftUI parity of `components/layout/BottomTabBar.tsx`. Renders the five canonical
/// tabs (Dashboard, Drives, Charging, Battery, Map) evenly across a chrome bar, marks the tab matching the
/// current route as active (theme tint + glow + accent pill), and forwards taps to the host router. Mount it at
/// the bottom of the compact (iPhone) shell — the native peer of the web `lg:hidden` mobile nav.
public struct BottomTabBar: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        BottomTabBarSurface.slug
    }

    private let input: BottomTabBarInput
    @State private var model: BottomTabBarModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The route-style initializer — the parity of `<BottomTabBar />` reading `useLocation()`. Binds the
    /// current `pathname`, the tab list (web `TABS`, defaulting to the canonical catalog), and the navigation
    /// callback (the P1/S8 binding to the router — the web `<PrefetchLink to=>`).
    public init(
        pathname: String,
        tabs: [BottomTabBarTab] = BottomTabBarCatalog.tabs,
        telemetry: any BottomTabBarTelemetry = OSLogBottomTabBarTelemetry(),
        localize: @escaping BottomTabBarLocalize = BottomTabBarStrings.localize,
        onNavigate: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        let resolved = BottomTabBarInput(pathname: pathname, tabs: tabs)
        input = resolved
        _model = State(initialValue: BottomTabBarModel(
            input: resolved,
            telemetry: telemetry,
            localize: localize,
            onNavigate: onNavigate
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, an identity resolver, a
    /// seeded route).
    public init(model: BottomTabBarModel) {
        input = model.boundInput
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(TSMaterial.chrome)
            .overlay(alignment: .top) { topBorder }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: model.projection.navigationLabel))
            .onAppear { model.start() }
            .onChange(of: input) { _, newInput in model.update(newInput) }
    }

    /// The tab row, or the friendly empty leaf when a host passes no tabs (never a blank box).
    @ViewBuilder
    private var content: some View {
        if model.projection.isEmpty {
            BottomTabBarEmptyState(message: model.localizedEmptyMessage)
        } else {
            HStack(spacing: 0) {
                ForEach(model.projection.tabs) { tab in
                    BottomTabBarItem(tab: tab, onSelect: { model.select(tab.path) })
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: model.projection.activeIndex)
        }
    }

    /// The hairline top border — the native peer of the web `border-t border-white/[0.06]`.
    private var topBorder: some View {
        Rectangle()
            .fill(Color.TS.border)
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}
