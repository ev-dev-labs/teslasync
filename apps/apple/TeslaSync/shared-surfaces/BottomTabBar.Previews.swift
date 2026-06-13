//
//  BottomTabBar.Previews.swift
//  TeslaSync — P4 shared surface · 0165 · BottomTabBar (Apple)
//
//  Xcode previews for every real branch of the bottom tab bar: the Dashboard-active default, a deep-route
//  active tab (the `to/` prefix match), the no-active case (the route matches no tab), and the native empty
//  catalog. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope. The
//  previews pass an identity localizer so the labels read deterministically without the app catalog.
//

import SwiftUI

#if DEBUG
    /// An identity resolver — returns each string's English fallback so previews read without the app catalog.
    private let previewLocalize: BottomTabBarLocalize = { _, fallback in fallback }

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
            content()
        }
        .frame(maxWidth: 430, maxHeight: 240, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.bg)
    }

    #Preview("Dashboard active — /") {
        staged("route /  ·  Home tab active") {
            BottomTabBar(pathname: "/", localize: previewLocalize)
        }
    }

    #Preview("Deep route active — /charging/abc") {
        staged("route /charging/abc  ·  Charging tab active (prefix match)") {
            BottomTabBar(pathname: "/charging/abc", localize: previewLocalize)
        }
    }

    #Preview("No active tab — /settings") {
        staged("route /settings  ·  no tab matches (all inactive)") {
            BottomTabBar(pathname: "/settings", localize: previewLocalize)
        }
    }

    #Preview("Empty catalog — never a blank box") {
        staged("no tabs  ·  friendly empty state") {
            BottomTabBar(pathname: "/", tabs: [], localize: previewLocalize)
        }
    }
#endif
