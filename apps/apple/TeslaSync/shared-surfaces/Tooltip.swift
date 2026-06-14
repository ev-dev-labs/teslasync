//
//  Tooltip.swift
//  TeslaSync — P4 shared surface · 0231 · Tooltip (Apple)
//
//  The public API of the hover / focus tooltip — the SwiftUI parity of `components/ui/Tooltip.tsx`. The web
//  source wraps a trigger (`children`) and reveals a floating `role="tooltip"` body on `:hover` /
//  `:focus-within`, positioned by `side`, optionally `multiline`, on an inverted high-contrast surface, with a
//  `scale-95 → scale-100` reveal that Reduce Motion disables. The native peer is ``Tooltip``: it lays the
//  ``TooltipBubble`` in an overlay anchored to the trigger edge (lifted clear by ``TooltipOutwardOffset``),
//  reveals it on pointer hover (`onHover` — the web `:hover`) and on tap (the web `:focus-within` peer for
//  touch, where tapping the trigger grants focus), and exposes the body copy to VoiceOver as the trigger's
//  accessibility hint (the web `aria-describedby`). It binds through ``TooltipController`` for the immutable
//  props, the reveal state, and the once-only `view.opened` telemetry (P1/S11). No networking, no Tailwind
//  ports.
//

import SwiftUI

// MARK: - Tooltip (web component root)

/// The hover / focus tooltip — the SwiftUI parity of the web `<Tooltip>`. It renders the trigger
/// (web `children`) with the floating ``TooltipBubble`` (web `content`) overlaid on the chosen ``TooltipSide``
/// (web `side`), revealed on hover / tap and announced to VoiceOver through the trigger's accessibility hint
/// (web `aria-describedby`). When the body is empty the bubble does not render (the P4 "never a blank box"
/// rule) and no telemetry fires. Emits `view.opened` once on first appear of a content-bearing instance.
@MainActor
public struct Tooltip<Trigger: View, Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        TooltipSurface.slug
    }

    private let controller: TooltipController
    private let content: () -> Content
    private let trigger: () -> Trigger

    @State private var isHovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Creates the tooltip with a custom body — the native peer of the web `content: ReactNode` escape hatch
    /// (rich content with its own layout). The `side` / `wrap` props and the reveal come from the controller.
    public init(
        controller: TooltipController,
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder trigger: @escaping () -> Trigger
    ) {
        self.controller = controller
        self.content = content
        self.trigger = trigger
    }

    /// The bubble is shown when pinned by tap (``TooltipController/isPresented``) OR while the pointer hovers
    /// the trigger — the native peer of the web `:hover` OR `:focus-within`.
    private var isVisible: Bool {
        controller.isPresented || isHovering
    }

    public var body: some View {
        trigger()
            .contentShape(Rectangle())
            .onHover { hovering in isHovering = hovering }
            .simultaneousGesture(TapGesture().onEnded { controller.toggle() })
            .accessibilityHint(Text(verbatim: controller.accessibilityDescription ?? ""))
            .overlay(alignment: controller.side.overlayAlignment) {
                if controller.hasContent {
                    TooltipBubble(
                        side: controller.side,
                        wrap: controller.wrap,
                        roleDescription: controller.roleDescription,
                        isVisible: isVisible,
                        reduceMotion: reduceMotion,
                        content: content
                    )
                    .modifier(TooltipOutwardOffset(side: controller.side, gap: TooltipMetrics.gap))
                }
            }
            .onAppear { controller.start() }
            .onDisappear { controller.stop() }
    }
}

// MARK: - String-body convenience initializers (web string `content`)

public extension Tooltip where Content == TooltipText {
    /// Creates the tooltip from a string body and the web props — the canonical call site (a one-line or
    /// `multiline` text tooltip over a trigger). Builds the ``TooltipController`` for the caller.
    init(
        _ text: String,
        side: TooltipSide = .webDefault,
        wrap: TooltipWrap = .webDefault,
        resolve: @escaping TooltipResolve = TooltipStrings.resolve,
        telemetry: any TooltipTelemetry = OSLogTooltipTelemetry(),
        @ViewBuilder trigger: @escaping () -> Trigger
    ) {
        let controller = TooltipController(
            text: text,
            side: side,
            wrap: wrap,
            resolve: resolve,
            telemetry: telemetry
        )
        self.init(
            controller: controller,
            content: { TooltipText(text: controller.text, wrap: controller.wrap) },
            trigger: trigger
        )
    }

    /// Creates the tooltip from an existing controller, rendering its text body — for call sites that hold the
    /// state-holder (e.g. to drive the reveal programmatically) but want the default string body.
    init(
        controller: TooltipController,
        @ViewBuilder trigger: @escaping () -> Trigger
    ) {
        self.init(
            controller: controller,
            content: { TooltipText(text: controller.text, wrap: controller.wrap) },
            trigger: trigger
        )
    }
}
