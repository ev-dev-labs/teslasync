//
//  HelpSegment.swift
//  TeslaSync — P4 shared surface · 0179 · HelpSegment (Apple)
//
//  The SwiftUI parity of `web/src/components/layout/status-bar/HelpSegment.tsx`: a footer status-bar
//  segment consolidating the three "always available" help affordances — press `?` for shortcuts, take a
//  tour, and report a bug. Each is an icon-led button with a tooltip + VoiceOver label that triggers a
//  decoupled host action (the native peer of the web window events), so the command palette and any other
//  surface keep working unchanged.
//
//  The view binds the ``HelpSegmentModel`` state-holder (P1/S8) for the i18n resolver, the decoupled
//  ``HelpSegmentActions``, and the once-only `view.opened` telemetry (P1/S11); no networking lives here.
//  Copy resolves through the P1/S10 facade and color comes from the P1/S9 tokens — no Tailwind ports, no
//  raw hex. The display density honours the web `iconOnly` prop crossed with the responsive `xl:inline`
//  breakpoint (driven by the horizontal size class on iOS / iPadOS; macOS windows always show the wide
//  form). The segment is the layout-agnostic peer of the web component — placement in the footer is a host
//  concern in SwiftUI.
//

import SwiftUI

/// The footer help segment — the SwiftUI parity of `HelpSegment.tsx`. Renders the three help affordances in
/// the web layout order, binding through ``HelpSegmentModel``, and adapts between the icon-only, compact,
/// and wide-label densities.
public struct HelpSegment: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        HelpSegmentSurface.slug
    }

    private let iconOnly: Bool
    @State private var model: HelpSegmentModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// The prop-style initializer — the parity of mounting `<HelpSegment iconOnly={…} />`. Wires the
    /// production resolver + decoupled actions (posting the matching notifications) + the `os.Logger`
    /// telemetry; hosts that own the destinations inject their own ``HelpSegmentActions``.
    public init(
        iconOnly: Bool = false,
        resolve: @escaping HelpSegmentResolve = HelpSegmentStrings.resolve,
        actions: HelpSegmentActions = HelpSegmentActions(),
        telemetry: any HelpSegmentTelemetry = OSLogHelpSegmentTelemetry()
    ) {
        self.iconOnly = iconOnly
        _model = State(
            initialValue: HelpSegmentModel(resolve: resolve, actions: actions, telemetry: telemetry)
        )
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a fake resolver, or
    /// recording action handlers).
    public init(iconOnly: Bool = false, model: HelpSegmentModel) {
        self.iconOnly = iconOnly
        _model = State(initialValue: model)
    }

    public var body: some View {
        let projection = model.projection(density: density)
        HStack(spacing: TSSpacing.xs) {
            ForEach(projection.actions) { action in
                HelpSegmentButton(projection: action, model: model)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("help-segment")
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    /// The resolved display density — the web `iconOnly` prop crossed with the `xl:inline` breakpoint.
    private var density: HelpSegmentDensity {
        HelpSegmentDensity.resolve(iconOnly: iconOnly, isWide: isWide)
    }

    /// Whether the available width is "wide" — the native peer of the web `xl` breakpoint. iOS / iPadOS
    /// uses the horizontal size class; macOS windows always show the wide form.
    private var isWide: Bool {
        #if os(iOS)
            return horizontalSizeClass == .regular
        #else
            return true
        #endif
    }
}
