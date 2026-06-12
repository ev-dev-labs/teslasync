//
//  HelpTooltip.swift
//  TeslaSync — P4 shared surface · 0216 · HelpTooltip (Apple)
//
//  The public API of the help "?" tooltip — the SwiftUI parity of `components/ui/HelpTooltip.tsx`. The web
//  source is a focusable "?" `<button>` (a lucide `HelpCircle`, or a caller-supplied glyph via `children`)
//  that composes the shared `<Tooltip>` to reveal an explanatory body on hover / focus / tap, with an
//  optional "Learn more" external link. The native peer is ``HelpTooltip``: the default `questionmark.circle`
//  trigger (or a caller-supplied glyph — the web `children` escape hatch) bound to the
//  ``HelpTooltipController``, presenting the floating ``HelpTooltipBody`` through a `.popover` on tap (the
//  HIG-idiomatic peer of a "?" help button, which dismisses on tap-outside / Escape for free) and the system
//  hover tooltip via `.help` — so the explanatory copy is reachable by pointer hover, tap, and VoiceOver
//  alike. The body's "Learn more" link opens in the browser (web `target="_blank"`). When the props resolve
//  to no content the view renders nothing (the web `return null`) and emits no telemetry. The surface binds
//  through the controller for the once-only `view.opened` telemetry (P1/S11). No networking, no Tailwind
//  ports.
//

import SwiftUI

// MARK: - HelpTooltip (web component root)

/// The help "?" tooltip — the SwiftUI parity of the web `<HelpTooltip>`. It renders a trigger glyph (the
/// default `questionmark.circle`, or a caller-supplied one — the web `children` prop) bound to the
/// ``HelpTooltipController``, and presents the floating ``HelpTooltipBody`` in a `.popover` on tap while also
/// exposing the copy as the system hover tooltip (`.help`) and as the VoiceOver hint. When the controller has
/// no resolved content (the web `if (!resolved) return null`) the view is an `EmptyView`. Emits `view.opened`
/// once on first appear of a content-bearing instance.
@MainActor
public struct HelpTooltip<Icon: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        HelpTooltipSurface.slug
    }

    private let controller: HelpTooltipController
    private let icon: () -> Icon

    /// Creates the tooltip with a caller-supplied trigger glyph — the native peer of the web `children`
    /// escape hatch (which replaces the `HelpCircle` glyph while keeping the focusable button chrome). The
    /// button's toggle action, accessible name, hover affordance, and popover are always supplied by
    /// ``HelpTooltip``.
    public init(
        controller: HelpTooltipController,
        @ViewBuilder icon: @escaping () -> Icon
    ) {
        self.controller = controller
        self.icon = icon
    }

    public var body: some View {
        @Bindable var bindable = controller
        return Group {
            if let content = controller.content {
                HelpTooltipIconButton(controller: controller, icon: icon)
                    .popover(isPresented: $bindable.isPresented, arrowEdge: controller.placement.arrowEdge) {
                        HelpTooltipBody(content: content, learnMoreLabel: controller.learnMoreLabel)
                            .presentationCompactAdaptation(.popover)
                    }
                    .help(Text(verbatim: content.text))
                    .accessibilityHint(Text(verbatim: content.text))
                    .onAppear { controller.start() }
                    .onDisappear { controller.stop() }
            }
        }
    }
}

// MARK: - Default trigger glyph (web `<HelpCircle>`)

public extension HelpTooltip where Icon == HelpTooltipDefaultIcon {
    /// Creates the tooltip with the default `questionmark.circle` glyph — the native peer of the web default
    /// `<HelpCircle>`, sized from the controller's ``HelpTooltipSize`` (web `SIZE_CLASS`).
    init(controller: HelpTooltipController) {
        self.init(controller: controller) { HelpTooltipDefaultIcon(size: controller.size) }
    }
}

// MARK: - Placement → popover arrow edge

extension HelpTooltipPlacement {
    /// The popover arrow edge for this placement — the native peer of the web Tooltip `side`. `top` /
    /// `bottom` place the tooltip above / below; `leading` / `trailing` (the web `left` / `right`) place it
    /// before / after in the layout direction.
    var arrowEdge: Edge {
        switch self {
        case .top: .top
        case .bottom: .bottom
        case .leading: .leading
        case .trailing: .trailing
        }
    }
}
