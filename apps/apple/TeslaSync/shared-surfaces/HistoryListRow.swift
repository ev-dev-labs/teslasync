//
//  HistoryListRow.swift
//  TeslaSync — P4 shared surface · 0091 · HistoryListRow (Apple)
//
//  The SwiftUI surface — the public API of the slot-based history row, the parity of the web
//  `<HistoryListRow checkbox leading primary route metrics insight actions href onClick selected glow
//  hideChevron />`. Like the web component it is driven entirely by its slot nodes + structural props;
//  there is no data source, so there is nothing to wire. The view binds through ``HistoryListRowModel``
//  (P1/S8) for the derived projection + the once-only `view.opened` telemetry (P1/S11), and pushes
//  structural-prop changes into the holder via `.onChange` so a reused list cell re-renders faithfully.
//  No networking, no Tailwind ports — chrome is token-driven (P1/S9) and the lone VoiceOver hint
//  resolves through P1/S10.
//
//  Slot erasure: the six content slots are arbitrary caller-composed views (the web `ReactNode`
//  slots), so they are type-erased to `AnyView?` — the same slot-container pattern the shared
//  `DataTable` cell builder uses — with a `nil` standing in for an omitted slot (web `slot != null`).
//  The generic initializer keeps the call site type-safe (the caller passes real `@ViewBuilder`
//  closures); erasure happens once, inside `init`, so the surface stays a single concrete type.
//

import SwiftUI

// MARK: - HistoryListRowActivation (web `href` xor `onClick`)

/// The row's activation — the native peer of the web's mutually-exclusive `href` / `onClick` props.
/// `link` mirrors the web `<Link to={href}>` wrap: it carries the `href` (for accessibility + tests)
/// and a `perform` closure the embedder wires to its navigator (the native peer of react-router
/// resolving the link — the surface stays decoupled from the app's routing). `action` mirrors the web
/// `onClick` on the panel. `none` is a non-navigable row whose only interactive parts are its slotted
/// checkbox / action controls.
public enum HistoryListRowActivation {
    /// Neither `href` nor `onClick` — the row body is inert.
    case none
    /// Web `href` — navigate to `href`; `perform` is the embedder's navigation action.
    case link(href: String, perform: @MainActor () -> Void)
    /// Web `onClick` — fire `perform` on tap.
    case action(perform: @MainActor () -> Void)

    /// The Equatable-friendly kind, fed into ``HistoryListRowInputs`` (closures are not Equatable).
    var kind: HistoryListRowActivationKind {
        switch self {
        case .none: .none
        case .link: .link
        case .action: .action
        }
    }

    /// The link target (web `href`); `nil` for `none` / `action`.
    var href: String? {
        if case let .link(href, _) = self { return href }
        return nil
    }

    /// The tap handler the row fires when activated; `nil` for the inert `none` row.
    var perform: (@MainActor () -> Void)? {
        switch self {
        case .none: nil
        case let .link(_, perform): perform
        case let .action(perform): perform
        }
    }
}

// MARK: - HistoryListRow (the slot-based shared surface)

/// `HistoryListRow` — the SwiftUI parity of `components/data-display/HistoryListRow.tsx`: a generic,
/// slot-based row for history-style pages (the native peer of the web rows used by Drives' `DriveCard`
/// and Charging's `ChargingSessionCard`). Renders the real branches of the web source — checkbox /
/// leading / route / metrics / insight / actions present or absent, link / action / inert activation,
/// selected tint, glow, chevron — with the same tap-isolation (checkbox + actions taps never trigger
/// the row) and the same top-down slot layout.
public struct HistoryListRow: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = HistoryListRowSurface.slug

    private let glow: HistoryListRowGlow
    private let selected: Bool
    private let hideChevron: Bool
    private let activation: HistoryListRowActivation
    private let actions: [AnyView]
    private let primarySlot: AnyView
    private let checkboxSlot: AnyView?
    private let leadingSlot: AnyView?
    private let routeSlot: AnyView?
    private let metricsSlot: AnyView?
    private let insightSlot: AnyView?

    @State private var model: HistoryListRowModel

    /// The prop-style initializer — the parity of the web `<HistoryListRow … />`. `primary` is the
    /// one required slot; the rest default to omitted (web `undefined`), and an `EmptyView` builder is
    /// detected as "omitted" so it does not reserve layout. `glow` defaults to `cyan` and `selected` /
    /// `hideChevron` to `false`, matching the web defaults.
    public init<Checkbox: View, Leading: View, Route: View, Metrics: View, Insight: View>(
        glow: HistoryListRowGlow = .defaultGlow,
        selected: Bool = false,
        hideChevron: Bool = false,
        activation: HistoryListRowActivation = .none,
        actions: [AnyView] = [],
        @ViewBuilder primary: () -> some View,
        @ViewBuilder checkbox: () -> Checkbox = { EmptyView() },
        @ViewBuilder leading: () -> Leading = { EmptyView() },
        @ViewBuilder route: () -> Route = { EmptyView() },
        @ViewBuilder metrics: () -> Metrics = { EmptyView() },
        @ViewBuilder insight: () -> Insight = { EmptyView() },
        telemetry: any HistoryListRowTelemetry = OSLogHistoryListRowTelemetry()
    ) {
        self.glow = glow
        self.selected = selected
        self.hideChevron = hideChevron
        self.activation = activation
        self.actions = actions
        primarySlot = AnyView(primary())
        checkboxSlot = Self.slot(checkbox)
        leadingSlot = Self.slot(leading)
        routeSlot = Self.slot(route)
        metricsSlot = Self.slot(metrics)
        insightSlot = Self.slot(insight)

        let resolvedInputs = HistoryListRowInputs(
            glow: glow,
            selected: selected,
            hideChevron: hideChevron,
            activationKind: activation.kind,
            href: activation.href,
            hasCheckbox: Checkbox.self != EmptyView.self,
            hasLeading: Leading.self != EmptyView.self,
            hasRoute: Route.self != EmptyView.self,
            hasMetrics: Metrics.self != EmptyView.self,
            hasInsight: Insight.self != EmptyView.self,
            actionCount: actions.count
        )
        _model = State(initialValue: HistoryListRowModel(inputs: resolvedInputs, telemetry: telemetry))
    }

    public var body: some View {
        HistoryListRowContentView(
            projection: model.projection,
            accessibilityHint: model.accessibilityHint,
            slots: HistoryListRowSlotViews(
                checkbox: checkboxSlot,
                leading: leadingSlot,
                primary: primarySlot,
                route: routeSlot,
                metrics: metricsSlot,
                insight: insightSlot,
                actions: actions
            ),
            perform: activation.perform
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: currentInputs) { _, newInputs in
            model.update(newInputs)
        }
    }

    /// The structural props recomputed from the live slot presence + style — the `.onChange` key that
    /// lets a reused list cell re-derive its layout when the host swaps which slots it populates.
    private var currentInputs: HistoryListRowInputs {
        HistoryListRowInputs(
            glow: glow,
            selected: selected,
            hideChevron: hideChevron,
            activationKind: activation.kind,
            href: activation.href,
            hasCheckbox: checkboxSlot != nil,
            hasLeading: leadingSlot != nil,
            hasRoute: routeSlot != nil,
            hasMetrics: metricsSlot != nil,
            hasInsight: insightSlot != nil,
            actionCount: actions.count
        )
    }

    /// Erases a slot to `AnyView`, mapping an `EmptyView` builder to `nil` (web `undefined` slot) so it
    /// reserves no layout. The builder is only invoked for a real slot.
    private static func slot<V: View>(_ build: () -> V) -> AnyView? {
        V.self == EmptyView.self ? nil : AnyView(build())
    }
}
