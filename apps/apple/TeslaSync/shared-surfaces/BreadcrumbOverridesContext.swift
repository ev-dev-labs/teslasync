//
//  BreadcrumbOverridesContext.swift
//  TeslaSync — P4 shared surface · 0166 · BreadcrumbOverridesContext (Apple)
//
//  The SwiftUI surface — the parity of components/layout/BreadcrumbOverridesContext.tsx. The web source
//  is a React context (`createContext<BreadcrumbOverridesContextValue | null>(null)`) plus a reader
//  hook (`useBreadcrumbOverrides`), a writer hook (`useSetBreadcrumbOverrides`), and a provider; the
//  idiomatic SwiftUI equivalent of a React context is an Environment value, so this file exposes:
//
//    • EnvironmentValues.breadcrumbOverridesState — the parity of the React context. It resolves to the
//      active ``BreadcrumbOverridesState`` (the merged map + register / unregister), or `nil` outside a
//      provider (web `useContext(...) → null`), so `useBreadcrumbOverrides()` reads `{}` there.
//    • BreadcrumbOverridesProvider — the parity of `<BreadcrumbOverridesProvider>`. It owns the
//      per-provider ``BreadcrumbOverridesState`` over a store, injects it into the environment for
//      every descendant, and emits `view.opened` once.
//    • BreadcrumbOverridesReader — the parity of `useBreadcrumbOverrides()`: it reads the context from
//      the environment and hands the resolved merged ``BreadcrumbOverrideMap`` (`[:]` outside a
//      provider) to a builder, so a call site can branch on the overrides exactly as web consumers do.
//    • .breadcrumbOverridesProvider() — the ergonomic, idiomatic-Swift spelling of the provider wrap.
//    • .setBreadcrumbOverrides(_:) — the parity of `useSetBreadcrumbOverrides(map)`: a page attaches it
//      to register its dynamic labels for the current route, and they are unregistered on disappear.
//      It is JSON-stable (the registration is skipped when the map's content is unchanged, web
//      `serialised`), so passing a fresh literal every render is safe.
//
//  No networking, no Tailwind ports, no raw hex — chrome is token-driven (P1/S9) and copy resolves
//  through P1/S10. The breadcrumb trail renderer that consumes the context lives in
//  BreadcrumbOverridesContext.Views.swift.
//

import SwiftUI

// MARK: - Environment (web React context `BreadcrumbOverridesContext`)

/// The environment slot carrying the active breadcrumb-overrides context — the SwiftUI analog of the
/// web `createContext<BreadcrumbOverridesContextValue | null>(null)`. The default is `nil` so a
/// consumer outside any provider resolves exactly as the web `useBreadcrumbOverrides()` does (`{}`).
private struct BreadcrumbOverridesStateKey: EnvironmentKey {
    static let defaultValue: BreadcrumbOverridesState? = nil
}

public extension EnvironmentValues {
    /// The active breadcrumb-overrides context (web React context) — `nil` outside a
    /// ``BreadcrumbOverridesProvider``. Descendants read `breadcrumbOverridesState?.overrides ?? [:]`
    /// for the merged labels (web `useBreadcrumbOverrides()`), or attach ``SwiftUI/View/
    /// setBreadcrumbOverrides(_:)`` to push their own (web `useSetBreadcrumbOverrides`).
    var breadcrumbOverridesState: BreadcrumbOverridesState? {
        get { self[BreadcrumbOverridesStateKey.self] }
        set { self[BreadcrumbOverridesStateKey.self] = newValue }
    }
}

// MARK: - BreadcrumbOverridesProvider (web `<BreadcrumbOverridesProvider>`)

/// The breadcrumb-overrides provider — the SwiftUI parity of `<BreadcrumbOverridesProvider>`. Wrap the
/// app shell (or any subtree) in one provider; every descendant page then registers its dynamic
/// breadcrumb labels into the same context, and the global trail reads the merged map. It owns the
/// per-provider ``BreadcrumbOverridesState`` over a store (defaulting to the process-wide
/// ``BreadcrumbOverridesStore``) and emits `view.opened` once.
public struct BreadcrumbOverridesProvider<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        BreadcrumbOverridesSurface.slug
    }

    @State private var model: BreadcrumbOverridesState
    private let content: Content

    /// Production initializer — the parity of `<BreadcrumbOverridesProvider>`. Builds the
    /// per-provider ``BreadcrumbOverridesState`` over `store` (defaulting to the process-wide
    /// ``BreadcrumbOverridesStore``, the single Layout-level provider).
    public init(
        store: BreadcrumbOverridesStore = .shared,
        @ViewBuilder content: () -> Content
    ) {
        _model = State(initialValue: BreadcrumbOverridesState(store: store))
        self.content = content()
    }

    /// Model-injecting initializer — used by previews + tests that drive a fresh
    /// ``BreadcrumbOverridesStore`` and want to assert against the bound model.
    public init(state: BreadcrumbOverridesState, @ViewBuilder content: () -> Content) {
        _model = State(initialValue: state)
        self.content = content()
    }

    public var body: some View {
        content
            .environment(\.breadcrumbOverridesState, model)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }
}

// MARK: - BreadcrumbOverridesReader (web `useBreadcrumbOverrides()`)

/// Reads the active breadcrumb-overrides context from the environment and hands the resolved merged
/// ``BreadcrumbOverrideMap`` to a builder — the native parity of the web `useBreadcrumbOverrides()`
/// hook (which returns the merged map, or `{}` outside a provider). Use it when a call site wants the
/// map in hand rather than reading `@Environment` directly.
public struct BreadcrumbOverridesReader<Content: View>: View {
    @Environment(\.breadcrumbOverridesState) private var state
    private let content: (BreadcrumbOverrideMap) -> Content

    public init(@ViewBuilder content: @escaping (BreadcrumbOverrideMap) -> Content) {
        self.content = content
    }

    public var body: some View {
        content(state?.overrides ?? [:])
    }
}

// MARK: - useSetBreadcrumbOverrides (web `useSetBreadcrumbOverrides(map)`)

/// The view modifier behind ``SwiftUI/View/setBreadcrumbOverrides(_:)`` — the parity of
/// `useSetBreadcrumbOverrides(map)`. It registers the map with the nearest provider on appear and
/// whenever the map's content changes (compared by the JSON-stable signature so an identical literal
/// re-render does NOT re-register, web `serialised`), and unregisters on disappear or when the map
/// becomes empty / `nil`. Outside a provider it is inert (web `if (!ctx) return`).
private struct SetBreadcrumbOverridesModifier: ViewModifier {
    @Environment(\.breadcrumbOverridesState) private var state
    let map: BreadcrumbOverrideMap?
    @State private var registrationID: Int?

    /// The content-stable signature compared across renders (web `serialised`); empty when there is
    /// nothing to register.
    private var signature: String {
        guard let map else { return "" }
        return BreadcrumbOverridesReducer.signature(map)
    }

    func body(content: Content) -> some View {
        content
            .onAppear { sync() }
            .onChange(of: signature) { sync() }
            .onDisappear { clearRegistration() }
    }

    /// Registers the current map (allocating a fresh id), unregistering any prior registration first —
    /// the parity of the web effect's cleanup-then-register on a `serialised` change.
    private func sync() {
        guard let state else { return }
        clearRegistration()
        guard !signature.isEmpty else { return }
        registrationID = state.registerOverrides(map)
    }

    /// Unregisters the current registration, if any — web effect cleanup / the empty-map branch.
    private func clearRegistration() {
        guard let state, let id = registrationID else { return }
        state.unregister(id: id)
        registrationID = nil
    }
}

public extension View {
    /// Wraps `self` in a ``BreadcrumbOverridesProvider`` — the ergonomic, idiomatic-Swift spelling of
    /// the web `<BreadcrumbOverridesProvider>` wrap. Every page inside the receiver shares one
    /// breadcrumb-overrides context.
    func breadcrumbOverridesProvider(store: BreadcrumbOverridesStore = .shared) -> some View {
        BreadcrumbOverridesProvider(store: store) { self }
    }

    /// Registers a page's breadcrumb label overrides for the current route — the parity of
    /// `useSetBreadcrumbOverrides(map)`. The labels are merged into the global breadcrumb while this
    /// view is on screen and unregistered when it disappears. Pass `nil` (or omit) to register nothing.
    /// Stable across renders: an identical map's content is not re-registered (web JSON compare).
    func setBreadcrumbOverrides(_ map: BreadcrumbOverrideMap?) -> some View {
        modifier(SetBreadcrumbOverridesModifier(map: map))
    }
}
