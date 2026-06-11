//
//  InlineCallout.swift
//  TeslaSync — P4 shared surface · 0124 · InlineCallout (Apple)
//
//  The public API of the single-line, low-chrome contextual callout — the SwiftUI parity of
//  `components/feedback/InlineCallout.tsx`. Like the web component it is driven entirely by its props
//  (`variant`, optional `icon`, the `message` body — web `children` — and an optional `action`); there
//  is no fetcher. The view binds through ``InlineCalloutModel`` for the once-only `view.opened`
//  telemetry (P1/S11) + the derived projection, composes the token-driven chrome via
//  ``InlineCalloutContainer`` (P1/S9), and pushes prop changes into the holder via `.onChange` so a
//  reused callout re-renders faithfully. No networking, no Tailwind ports.
//
//  Rich-content note: the web `children` is a `ReactNode`; in practice the callout carries a single
//  inline insight string, so this surface's prop initializer takes a `message: String`. A host that
//  needs rich inline content composes ``InlineCalloutContainer`` directly (the same primitive this
//  surface uses), keeping full parity without a generic public surface.
//

import SwiftUI

// MARK: - InlineCalloutAction (web `action`)

/// The optional action — the native peer of the web `action` prop (`{ label, href?, onClick? }`). A
/// `url` maps the web `href` (renders a link, the OS opens it); an `onTap` maps the web `onClick`
/// (renders a button). Passing both prefers the `url`, exactly like the web. The closure is held by the
/// surface's state-holder so the `Equatable` ``InlineCalloutInput`` stays closure-free.
public struct InlineCalloutAction {
    public let label: String
    public let url: URL?
    public let onTap: (@MainActor () -> Void)?

    public init(label: String, url: URL? = nil, onTap: (@MainActor () -> Void)? = nil) {
        self.label = label
        self.url = url
        self.onTap = onTap
    }

    /// A navigating action — web `action.href`.
    public static func link(_ label: String, url: URL) -> InlineCalloutAction {
        InlineCalloutAction(label: label, url: url)
    }

    /// An in-app action — web `action.onClick`.
    public static func button(_ label: String, onTap: @escaping @MainActor () -> Void) -> InlineCalloutAction {
        InlineCalloutAction(label: label, onTap: onTap)
    }
}

// MARK: - InlineCallout (the shared surface)

/// The contextual callout — the SwiftUI parity of `components/feedback/InlineCallout.tsx`. Renders a
/// tinted, ringed inline row (leading icon + body + optional trailing action affordance) in one of the
/// four severity variants, as a status row (web `<div role="status">`), a link (web `<a href>`), or a
/// button (web `<button onClick>`). A single-line insight that lives inside a larger card — distinct
/// from the page-level ``AlertBanner``.
public struct InlineCallout: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = InlineCalloutSurface.slug

    private let input: InlineCalloutInput
    @State private var model: InlineCalloutModel

    /// The prop-style initializer — the parity of `<InlineCallout variant icon action>{children}`.
    /// `message` is the web `children`; `icon` is an optional SF Symbol (web `icon`); `action` is the
    /// optional web `action` (a link when it carries a `url`, a button when it carries an `onTap`).
    public init(
        _ variant: InlineCalloutVariant,
        message: String,
        icon: String? = nil,
        action: InlineCalloutAction? = nil,
        telemetry: any InlineCalloutTelemetry = OSLogInlineCalloutTelemetry()
    ) {
        let interaction = InlineCalloutInteraction.resolve(
            url: action?.url,
            hasTapAction: action?.onTap != nil
        )
        let resolved = InlineCalloutInput(
            variant: variant,
            iconSystemName: icon,
            message: message,
            actionLabel: action?.label,
            interaction: interaction
        )
        input = resolved
        _model = State(initialValue: InlineCalloutModel(
            input: resolved,
            onActivate: action?.onTap,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: InlineCalloutModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        let projection = model.projection
        return InlineCalloutContainer(
            variant: projection.variant,
            iconSystemName: projection.iconSystemName,
            trailingLabel: projection.trailingLabel,
            interaction: projection.interaction,
            accessibilityLabel: projection.accessibilityLabel,
            onActivate: { model.activate() },
            content: { Text(verbatim: projection.message) }
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput)
        }
    }
}
