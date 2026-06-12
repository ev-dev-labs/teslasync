//
//  HealthRow.swift
//  TeslaSync — P4 shared surface · 0197 · HealthRow (Apple)
//
//  The SwiftUI surface — the public API of the single-line health summary row, the parity of the web
//  `<HealthRow status icon label summary to external onClick />`. Like the web component it is driven
//  entirely by its props + the one optional icon slot; there is no data source, so there is nothing to
//  wire. The view binds through ``HealthRowModel`` (P1/S8) for the derived projection + the localized
//  VoiceOver label/hint + the once-only `view.opened` telemetry (P1/S11), and pushes prop changes into
//  the holder via `.onChange` so a reused row re-renders faithfully. No networking, no Tailwind ports —
//  chrome is token-driven (P1/S9) and every string resolves through P1/S10.
//
//  Icon erasure: the optional `icon` is an arbitrary caller-composed view (the web `ReactNode` icon
//  slot), so it is type-erased to `AnyView?` — the same slot pattern the sibling `HistoryListRow` uses
//  — with a `nil` standing in for an omitted icon (web `icon != null`). The generic initializer keeps
//  the call site type-safe (the caller passes a real `@ViewBuilder` closure); erasure happens once,
//  inside `init`, so the surface stays a single concrete type.
//

import SwiftUI

// MARK: - HealthRowActivation (web `to` / `external` / `onClick`)

/// The row's activation — the native peer of the web's `to` / `external` / `onClick` props. `link`
/// mirrors the web internal `<Link to={to}>` wrap; `externalLink` mirrors the web `<a href={to}
/// target="_blank">` wrap (web `to` with `external`); `action` mirrors the web `<button onClick>`. Each
/// link case carries its `to` (for accessibility + tests) and a `perform` closure the embedder wires to
/// its navigator / URL opener (the native peer of react-router resolving the link or the browser
/// opening the external target — the surface stays decoupled from the app's routing). `none` is an
/// inert summary row (web `<div>`).
public enum HealthRowActivation {
    /// Neither `to` nor `onClick` — the row is an inert summary line.
    case none
    /// Web internal `to` — navigate in-app; `perform` is the embedder's navigation action.
    case link(to: String, perform: @MainActor () -> Void)
    /// Web `to` + `external` — open an external target out of the app; `perform` opens it.
    case externalLink(to: String, perform: @MainActor () -> Void)
    /// Web `onClick` — fire `perform` on tap.
    case action(perform: @MainActor () -> Void)

    /// The Equatable-friendly kind, fed into ``HealthRowInputs`` (closures are not Equatable).
    var kind: HealthRowActivationKind {
        switch self {
        case .none: .none
        case .link: .link
        case .externalLink: .externalLink
        case .action: .action
        }
    }

    /// The link target (web `to`); `nil` for `none` / `action`.
    var href: String? {
        switch self {
        case let .link(to, _), let .externalLink(to, _): to
        case .none, .action: nil
        }
    }

    /// The tap handler the row fires when activated; `nil` for the inert `none` row.
    var perform: (@MainActor () -> Void)? {
        switch self {
        case .none: nil
        case let .link(_, perform), let .externalLink(_, perform): perform
        case let .action(perform): perform
        }
    }
}

// MARK: - HealthRow (the shared surface)

/// `HealthRow` — the SwiftUI parity of `components/status/HealthRow.tsx`: a single-line health summary
/// row (an icon, a label, a right-aligned summary, and a "view" chevron) whose dot + summary recolour
/// by status. Stack these inside a panel for a high-density at-a-glance health grid. Renders the real
/// branches of the web source — each status, icon present / absent, internal link / external link /
/// action / inert activation, chevron when navigable — with the web composition and tap semantics.
public struct HealthRow: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = HealthRowSurface.slug

    private let status: HealthRowStatus
    private let label: String
    private let summary: String
    private let activation: HealthRowActivation
    private let iconSlot: AnyView?

    @State private var model: HealthRowModel

    /// The prop-style initializer — the parity of the web `<HealthRow … />`. `status` / `label` /
    /// `summary` are required (matching the web required props); `activation` defaults to inert (web no
    /// `to` / `onClick`) and the `icon` builder defaults to omitted (web `undefined`), detected as an
    /// `EmptyView` so it reserves no layout.
    public init<Icon: View>(
        status: HealthRowStatus,
        label: String,
        summary: String,
        activation: HealthRowActivation = .none,
        @ViewBuilder icon: () -> Icon = { EmptyView() },
        telemetry: any HealthRowTelemetry = OSLogHealthRowTelemetry()
    ) {
        self.status = status
        self.label = label
        self.summary = summary
        self.activation = activation
        iconSlot = Self.slot(icon)

        let resolvedInputs = HealthRowInputs(
            status: status,
            label: label,
            summary: summary,
            hasIcon: Icon.self != EmptyView.self,
            activationKind: activation.kind,
            href: activation.href
        )
        _model = State(initialValue: HealthRowModel(inputs: resolvedInputs, telemetry: telemetry))
    }

    public var body: some View {
        HealthRowContentView(
            projection: model.projection,
            accessibilityLabel: model.accessibilityLabel,
            accessibilityHint: model.accessibilityHint,
            icon: iconSlot,
            perform: activation.perform
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: currentInputs) { _, newInputs in
            model.update(newInputs)
        }
    }

    /// The props recomputed from the live values — the `.onChange` key that lets a reused row re-derive
    /// its layout when the host swaps the status / label / summary / icon presence / activation.
    private var currentInputs: HealthRowInputs {
        HealthRowInputs(
            status: status,
            label: label,
            summary: summary,
            hasIcon: iconSlot != nil,
            activationKind: activation.kind,
            href: activation.href
        )
    }

    /// Erases the icon to `AnyView`, mapping an `EmptyView` builder to `nil` (web `undefined` icon) so
    /// it reserves no layout. The builder is only invoked for a real icon.
    private static func slot<V: View>(_ build: () -> V) -> AnyView? {
        V.self == EmptyView.self ? nil : AnyView(build())
    }
}
