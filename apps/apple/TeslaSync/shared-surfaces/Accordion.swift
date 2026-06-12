//
//  Accordion.swift
//  TeslaSync — P4 shared surface · 0203 · Accordion (Apple)
//
//  The public API of the collapsible section — the SwiftUI parity of `components/ui/Accordion.tsx`. Like
//  the web component it is driven entirely by its props (`title`, the controlled `open` + `onOpenChange`,
//  `defaultOpen`, and the optional `icon` / `badge` / `headerExtra` regions) and wraps arbitrary `children`;
//  there is no fetcher. It supports the web's controlled (parent owns `open`) and uncontrolled
//  (`defaultOpen` + internal state) modes from one initializer, exactly as the source switches on `open !=
//  undefined && onOpenChange != undefined`. The view binds through ``AccordionModel`` for the open-state
//  interaction + the once-only `view.opened` telemetry (P1/S11), composes the token-driven chrome (P1/S9),
//  honors Reduce Motion at the open/close boundary, and pushes prop changes into the holder via `.onChange`
//  so a reused / controlled section re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The collapsible section — the SwiftUI parity of `components/ui/Accordion.tsx`. Renders a header button
/// (optional icon, title, optional badge + headerExtra, rotating chevron) over an animated body that
/// reveals its `children`. Controlled when both `open` and `onOpenChange` are supplied (the parent owns the
/// source of truth — useful for URL state, persisting across remount, or programmatic toggling); otherwise
/// uncontrolled, seeded from `defaultOpen`. Mount it to group secondary detail a user can expand on demand.
public struct Accordion<Content: View, Icon: View, Badge: View, Extra: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        AccordionSurface.slug
    }

    private let input: AccordionInput
    private let onOpenChange: (@MainActor (Bool) -> Void)?
    private let content: Content
    private let icon: Icon
    private let badge: Badge
    private let headerExtra: Extra
    @State private var model: AccordionModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<Accordion title open onOpenChange defaultOpen icon
    /// badge headerExtra>{children}</Accordion>`. Supplying BOTH `open` and `onOpenChange` switches the
    /// surface to controlled mode (the web `isControlled`); otherwise it is uncontrolled and seeded from
    /// `defaultOpen`. The `icon` / `badge` / `headerExtra` builders default to `EmptyView` so a bare
    /// `Accordion(title:) { … }` renders just the title + chevron, mirroring the web optional regions.
    public init(
        title: String,
        defaultOpen: Bool = false,
        open: Bool? = nil,
        onOpenChange: (@MainActor (Bool) -> Void)? = nil,
        telemetry: any AccordionTelemetry = OSLogAccordionTelemetry(),
        @ViewBuilder icon: () -> Icon = { EmptyView() },
        @ViewBuilder badge: () -> Badge = { EmptyView() },
        @ViewBuilder headerExtra: () -> Extra = { EmptyView() },
        @ViewBuilder content: () -> Content
    ) {
        let controlled = open != nil && onOpenChange != nil
        let resolved = AccordionInput(
            title: title,
            defaultOpen: defaultOpen,
            isControlled: controlled,
            controlledOpen: open ?? false,
            hasIcon: Icon.self != EmptyView.self,
            hasBadge: Badge.self != EmptyView.self,
            hasHeaderExtra: Extra.self != EmptyView.self
        )
        input = resolved
        self.onOpenChange = controlled ? onOpenChange : nil
        self.icon = icon()
        self.badge = badge()
        self.headerExtra = headerExtra()
        self.content = content()
        _model = State(initialValue: AccordionModel(
            input: resolved,
            onOpenChange: controlled ? onOpenChange : nil,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded open state).
    public init(
        model: AccordionModel,
        @ViewBuilder icon: () -> Icon = { EmptyView() },
        @ViewBuilder badge: () -> Badge = { EmptyView() },
        @ViewBuilder headerExtra: () -> Extra = { EmptyView() },
        @ViewBuilder content: () -> Content
    ) {
        input = model.input
        onOpenChange = nil
        self.icon = icon()
        self.badge = badge()
        self.headerExtra = headerExtra()
        self.content = content()
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            AccordionHeader(
                model: model,
                icon: icon,
                badge: badge,
                headerExtra: headerExtra,
                onToggle: { model.toggle() }
            )
            if model.projection.showsBody {
                AccordionBody(content: content)
                    .transition(.opacity)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .animation(AccordionMotion.toggle(reduce: reduceMotion), value: model.projection.isOpen)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput, onOpenChange: onOpenChange)
        }
    }
}
