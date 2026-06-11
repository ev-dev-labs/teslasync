//
//  RequiresAuth.swift
//  TeslaSync — P4 shared surface · 0137 · RequiresAuth (Apple)
//
//  The auth-gated section wrapper — the SwiftUI parity of components/feedback/RequiresAuth.tsx. The
//  web source wraps any section that has no useful behaviour without an upstream identity provider:
//  in forward-auth mode (with the needed capability enabled) the wrapped content renders unchanged;
//  in open mode (or while the `/system/auth-mode` contract is loading) it renders a provider-agnostic
//  lock notice explaining what to configure. The native surface is a generic
//  `RequiresAuth<Content>` taking the protected section as a `@ViewBuilder` (web `children`): it
//  switches over the model's resolved `render` so the gate is reproduced (the children mount only
//  when unlocked) and the lock notice switches over its phase so every prompt-required state renders
//  (loading / locked / error) — never a blank box. All data + presentation lives in
//  `RequiresAuthModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The auth-gated section wrapper, binding through `RequiresAuthModel` (P1/S8). The protected section
/// is supplied as a trailing `@ViewBuilder` (web `children`) and mounts only when the deployment is
/// in forward-auth mode with the needed capability enabled.
public struct RequiresAuth<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Computed (generic types cannot hold stored
    /// statics) so callers can reference it without specialising.
    public static var surfaceSlug: String {
        RequiresAuthSurface.slug
    }

    @State private var model: RequiresAuthModel
    private let content: Content

    /// Binds a pre-built model and the protected section. Use the convenience initialiser below for
    /// the common in-memory / production binding.
    public init(model: RequiresAuthModel, @ViewBuilder content: () -> Content) {
        _model = State(initialValue: model)
        self.content = content()
    }

    /// Convenience binding (web `<RequiresAuth capability feature>{children}`): builds the model from
    /// the capability + already-translated feature name + the bound P1/S8 source.
    public init(
        capability: RequiresAuthCapability,
        feature: String,
        source: any RequiresAuthSource,
        telemetry: any RequiresAuthTelemetry = OSLogRequiresAuthTelemetry(),
        localize: @escaping (String, String) -> String = RequiresAuthStrings.string,
        @ViewBuilder content: () -> Content
    ) {
        let model = RequiresAuthModel(
            capability: capability,
            feature: feature,
            source: source,
            telemetry: telemetry,
            localize: localize
        )
        _model = State(initialValue: model)
        self.content = content()
    }

    public var body: some View {
        gated
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The web gate ladder resolved to a rendered surface: the protected section when unlocked (web
    /// `<>{children}</>`), else the lock notice chrome for every other state (web empty-state branch).
    @ViewBuilder
    private var gated: some View {
        switch model.render {
        case .content:
            content
        case .loading, .locked, .error:
            RequiresAuthLockNotice(model: model)
        }
    }
}
