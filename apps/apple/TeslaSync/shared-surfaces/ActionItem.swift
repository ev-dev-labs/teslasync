//
//  ActionItem.swift
//  TeslaSync — P4 shared surface · 0196 · ActionItem (Apple)
//
//  The SwiftUI surface — the public API of the single operator-task row, the parity of the web
//  `<ActionItem severity title description cta />`. Like the web component it is driven entirely by its
//  props; there is no data source, so there is nothing to wire. The view binds through ``ActionItemModel``
//  (P1/S8) for the derived projection + the localized CTA VoiceOver hint + the once-only `view.opened`
//  telemetry (P1/S11), composes the token-driven chrome via ``ActionItemContainer`` (P1/S9), and pushes
//  prop changes into the holder via `.onChange` so a reused row re-renders faithfully. No networking, no
//  Tailwind ports — every string resolves through P1/S10.
//
//  CTA closure note: the web `cta` carries an `onClick` (and resolves `to` to a router navigation); the
//  native peer keeps the surface decoupled from the app's routing by taking a `perform` closure per CTA
//  case (the embedder wires it to its navigator / URL opener), exactly as the sibling ``HealthRow`` does.
//  The closure is held here + on the state-holder's input is closure-free, so the `Equatable`
//  ``ActionItemInput`` stays comparable for the `.onChange` reuse guard.
//

import SwiftUI

// MARK: - ActionItemCTA (web `cta`)

/// The optional CTA — the native peer of the web `cta` prop (`{ label, to?, external?, onClick? }`).
/// `route` mirrors the web internal `<Link to={to}>`; `externalLink` mirrors the web `<a href={to}
/// target="_blank">` (web `to` + `external`), which leaves the app; `action` mirrors the web `<button
/// onClick>`. Each case carries its `label` and a `perform` closure the embedder wires to its navigator /
/// URL opener (the native peer of react-router resolving the link or the browser opening the external
/// target — the surface stays decoupled from the app's routing); the link cases also carry their `to`
/// (web `cta.to`) for accessibility + tests.
public enum ActionItemCTA {
    /// Web internal `to` — navigate in-app; `perform` is the embedder's navigation action.
    case route(label: String, to: String, perform: @MainActor () -> Void)
    /// Web `to` + `external` — open an external target out of the app; `perform` opens it.
    case externalLink(label: String, to: String, perform: @MainActor () -> Void)
    /// Web `onClick` — fire `perform` on tap.
    case action(label: String, perform: @MainActor () -> Void)

    /// The CTA button label (web `cta.label`).
    var label: String {
        switch self {
        case let .route(label, _, _), let .externalLink(label, _, _), let .action(label, _): label
        }
    }

    /// The Equatable-friendly kind, fed into ``ActionItemCTAInput`` (closures are not Equatable).
    var kind: ActionItemCTAKind {
        switch self {
        case .route: .route
        case .externalLink: .externalLink
        case .action: .action
        }
    }

    /// The link target (web `cta.to`); `nil` for the `action` kind (web `onClick` has no `to`).
    var href: String? {
        switch self {
        case let .route(_, to, _), let .externalLink(_, to, _): to
        case .action: nil
        }
    }

    /// The tap handler the CTA fires when activated (web `cta.onClick` / the router / URL opener).
    var perform: @MainActor () -> Void {
        switch self {
        case let .route(_, _, perform), let .externalLink(_, _, perform), let .action(_, perform): perform
        }
    }

    /// The closure-free props (web `cta` minus `onClick`), fed into the `Equatable` ``ActionItemInput``.
    var input: ActionItemCTAInput {
        ActionItemCTAInput(label: label, kind: kind, href: href)
    }
}

// MARK: - ActionItem (the shared surface)

/// `ActionItem` — the SwiftUI parity of `components/status/ActionItem.tsx`: a single operator-task row
/// (a severity glyph, a title + optional description, and an optional CTA button) on a tinted, ringed
/// surface whose colour encodes the severity. Stack these inside an `ActionItemsPanel` to surface things
/// the operator should do (run a backup, re-auth, install an update). Renders the real branches of the
/// web source — each severity, description present / absent, and the route / external-link / action /
/// no CTA wrapper — with the web composition and tap semantics.
public struct ActionItem: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ActionItemSurface.slug

    private let severity: ActionSeverity
    private let title: String
    private let description: String?
    private let cta: ActionItemCTA?

    @State private var model: ActionItemModel

    /// The prop-style initializer — the parity of the web `<ActionItem … />`. `severity` / `title` are
    /// required (matching the web required props); `description` defaults to omitted (web `undefined`),
    /// and `cta` defaults to no affordance (web no `cta`).
    public init(
        severity: ActionSeverity,
        title: String,
        description: String? = nil,
        cta: ActionItemCTA? = nil,
        telemetry: any ActionItemTelemetry = OSLogActionItemTelemetry()
    ) {
        self.severity = severity
        self.title = title
        self.description = description
        self.cta = cta

        let resolvedInput = ActionItemInput(
            severity: severity,
            title: title,
            description: description,
            cta: cta?.input
        )
        _model = State(initialValue: ActionItemModel(input: resolvedInput, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input). The
    /// `cta` perform closure is supplied separately so the injected model's input stays closure-free.
    public init(model: ActionItemModel, cta: ActionItemCTA? = nil) {
        severity = model.input.severity
        title = model.input.title
        description = model.input.description
        self.cta = cta
        _model = State(initialValue: model)
    }

    public var body: some View {
        ActionItemContainer(
            projection: model.projection,
            ctaAccessibilityHint: model.ctaAccessibilityHint,
            onActivateCTA: cta?.perform
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: currentInput) { _, newInput in
            model.update(newInput)
        }
    }

    /// The props recomputed from the live values — the `.onChange` key that lets a reused row re-derive
    /// its layout when the host swaps the severity / title / description / cta.
    private var currentInput: ActionItemInput {
        ActionItemInput(
            severity: severity,
            title: title,
            description: description,
            cta: cta?.input
        )
    }
}
