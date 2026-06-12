//
//  ThemeProvider.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  The SwiftUI surface — the parity of components/ui/ThemeProvider.tsx. The web source is a React
//  context provider plus the `useTheme()` hook; SwiftUI's idiomatic equivalent of a React context is an
//  Environment value, so this file exposes:
//
//    • EnvironmentValues.theme — the read side of `useTheme()` (the resolved `ResolvedTheme`). Defaults
//      to ``ResolvedTheme/default`` so a view outside any provider still styles itself (where the web
//      `useTheme()` would throw, the SwiftUI environment returns the same default the provider seeds —
//      strictly safer, and the standard SwiftUI contract).
//    • EnvironmentValues.themeController — the write side of `useTheme()` (the model exposing
//      `setColorway` / `setMode` / `setCustomColors`), or `nil` outside a provider.
//    • ThemeProvider — the parity of `<ThemeProvider>`. It owns the state-holder, injects the resolved
//      theme + controller into the environment for every descendant, applies the resolved scheme as
//      `preferredColorScheme`, the colorway primary as `tint`, and the mode background as a full-bleed
//      fill (the native peer of the web `applyThemeCSS` writing `:root` CSS vars + `body.background` +
//      the `color-scheme` / `dark` class). It tracks the ambient system appearance so `auto` resolves
//      live (web `matchMedia` listener), and starts/stops the model on appear/disappear.
//    • .themeProvider() — the ergonomic, idiomatic-Swift spelling of the same wrap.
//
//  No networking, no Tailwind ports, no raw hex at call sites: palette → `Color` happens through the
//  single `Color(themeColor:)` bridge below, and chrome elsewhere is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Color bridge (web hex/rgba literal → SwiftUI Color)

public extension Color {
    /// Bridges a parsed theme literal to a SwiftUI `Color` — the single place a `ThemeCSSColor` becomes
    /// a renderable color, so no call site re-parses hex or hardcodes a literal.
    init(themeColor: ThemeCSSColor) {
        self.init(
            .sRGB,
            red: themeColor.red,
            green: themeColor.green,
            blue: themeColor.blue,
            opacity: themeColor.opacity
        )
    }
}

// MARK: - Environment (web React context `ThemeContext`)

private struct ThemeEnvironmentKey: EnvironmentKey {
    static let defaultValue: ResolvedTheme = .default
}

private struct ThemeControllerEnvironmentKey: EnvironmentKey {
    static let defaultValue: ThemeProviderModel? = nil
}

public extension EnvironmentValues {
    /// The resolved theme — the read side of the web `useTheme()`. Defaults to
    /// ``ResolvedTheme/default`` outside a ``ThemeProvider``.
    var theme: ResolvedTheme {
        get { self[ThemeEnvironmentKey.self] }
        set { self[ThemeEnvironmentKey.self] = newValue }
    }

    /// The theme controller — the write side of the web `useTheme()` (`setColorway` / `setMode` /
    /// `setCustomColors`). `nil` outside a ``ThemeProvider``.
    var themeController: ThemeProviderModel? {
        get { self[ThemeControllerEnvironmentKey.self] }
        set { self[ThemeControllerEnvironmentKey.self] = newValue }
    }
}

// MARK: - ThemeProvider (web `<ThemeProvider>`)

/// The app-wide theme provider — the SwiftUI parity of the web `<ThemeProvider>`. Wrap the app root in
/// one provider; every descendant then reads the resolved theme (`@Environment(\.theme)`) and the
/// controller (`@Environment(\.themeController)`) from the environment. The provider applies the
/// resolved scheme/tint/background to its subtree and keeps `auto` in sync with the live system
/// appearance.
public struct ThemeProvider<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        ThemeProviderSurface.slug
    }

    @State private var model: ThemeProviderModel
    @Environment(\.colorScheme) private var systemColorScheme
    private let content: Content

    /// Production initializer — the parity of `<ThemeProvider>`. Seams default to local storage + the
    /// zero-network gateway + the cross-process `NotificationCenter` fan-out (the web cross-tab channel).
    public init(
        persistence: any ThemePersistence = UserDefaultsThemePersistence(),
        remote: any ThemeRemoteGateway = StaticThemeRemoteGateway(),
        broadcaster: any ThemeBroadcaster = NotificationCenterThemeBroadcaster(),
        telemetry: any ThemeProviderTelemetry = OSLogThemeProviderTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        _model = State(initialValue: ThemeProviderModel(
            persistence: persistence,
            remote: remote,
            broadcaster: broadcaster,
            telemetry: telemetry
        ))
        self.content = content()
    }

    /// Model-injecting initializer — used by previews + tests that drive in-memory seams and assert
    /// against the bound model.
    public init(model: ThemeProviderModel, @ViewBuilder content: () -> Content) {
        _model = State(initialValue: model)
        self.content = content()
    }

    public var body: some View {
        let resolved = model.resolved
        content
            .environment(\.theme, resolved)
            .environment(\.themeController, model)
            .tint(Color(themeColor: resolved.colorwayPalette.primary))
            .background(Color(themeColor: resolved.modePalette.background).ignoresSafeArea())
            .preferredColorScheme(resolved.effectiveColorScheme == .dark ? .dark : .light)
            .onAppear {
                model.updateSystemAppearance(prefersDark: systemColorScheme == .dark)
                model.start()
            }
            .onDisappear { model.stop() }
            .onChange(of: systemColorScheme) { _, newScheme in
                model.updateSystemAppearance(prefersDark: newScheme == .dark)
            }
    }
}

// MARK: - View modifier (idiomatic provider spelling)

public extension View {
    /// Wraps `self` in a ``ThemeProvider`` — the ergonomic, idiomatic-Swift spelling of the web
    /// `<ThemeProvider>` wrap. Every view inside the receiver reads the same resolved theme + controller
    /// from the environment.
    func themeProvider(
        persistence: any ThemePersistence = UserDefaultsThemePersistence(),
        remote: any ThemeRemoteGateway = StaticThemeRemoteGateway(),
        broadcaster: any ThemeBroadcaster = NotificationCenterThemeBroadcaster(),
        telemetry: any ThemeProviderTelemetry = OSLogThemeProviderTelemetry()
    ) -> some View {
        ThemeProvider(
            persistence: persistence,
            remote: remote,
            broadcaster: broadcaster,
            telemetry: telemetry
        ) { self }
    }
}
