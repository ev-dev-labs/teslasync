//
//  ConnectionSegment.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  The SwiftUI parity of `web/src/components/layout/status-bar/ConnectionSegment.tsx`: a compact footer
//  status-bar segment that polls the backend `/healthz` endpoint and surfaces the current API connection
//  health (latency + ok / degraded / offline) as a single chip — a tone dot + an icon + the "API" label +
//  a "· {latency}ms" / "· Offline" suffix — that links to the system-status page. Colour is paired with an
//  icon (and a state label in the tooltip / VoiceOver) so the state is legible to users with colour-vision
//  differences, exactly as the web component pairs each tone with a lucide glyph.
//
//  The view binds the ``ConnectionSegmentModel`` state-holder (P1/S8) for the snapshot + the resolved
//  projection and the once-only `view.opened` telemetry (P1/S11); no networking lives in the view. Copy
//  resolves through the P1/S10 facade and colour comes from the P1/S9 tokens — no Tailwind ports, no raw
//  hex. The web `iconOnly` prop is honoured (dot + icon only). Tapping invokes the host's navigation
//  handler (the native peer of the web `<Link to="/system-status">`); the default broadcasts
//  ``ConnectionSegmentSurface/openSystemStatusNotification`` so the app shell can route without the surface
//  owning the router. Placement in the footer is a host concern in SwiftUI.
//

import SwiftUI

// MARK: - ConnectionSegment (the shared surface)

/// The footer API-connection segment — the SwiftUI parity of `ConnectionSegment.tsx`. Renders every health
/// status in the compact chip, binding through ``ConnectionSegmentModel``, and links to the system-status
/// page on tap.
public struct ConnectionSegment: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ConnectionSegmentSurface.slug

    private let iconOnly: Bool
    private let onOpen: () -> Void
    @State private var model: ConnectionSegmentModel

    /// Designated initializer — adopts a fully-formed model (the production app threads its `/healthz`
    /// probe through ``PollingConnectionSegmentSource``; previews / tests inject an in-memory source + a
    /// telemetry spy) and the host's navigation handler.
    public init(
        iconOnly: Bool = false,
        model: ConnectionSegmentModel,
        onOpen: @escaping () -> Void = ConnectionSegment.defaultOpen
    ) {
        self.iconOnly = iconOnly
        self.onOpen = onOpen
        _model = State(initialValue: model)
    }

    /// Production convenience initializer — the parity of mounting `<ConnectionSegment iconOnly={…} />`
    /// over `useApiHealth`. The host supplies the `/healthz` probe (a closure over its `URLSession` + API
    /// base, honouring the web no-store + credentials + 5s-timeout semantics); the poll cadence + telemetry
    /// default to the web-faithful values and the navigation defaults to the NotificationCenter broadcast.
    public init(
        iconOnly: Bool = false,
        probe: any ConnectionHealthProbe,
        poller: any ConnectionSegmentPoller = TimerConnectionSegmentPoller(),
        telemetry: any ConnectionSegmentTelemetry = OSLogConnectionSegmentTelemetry(),
        onOpen: @escaping () -> Void = ConnectionSegment.defaultOpen
    ) {
        self.init(
            iconOnly: iconOnly,
            model: ConnectionSegmentModel(
                source: PollingConnectionSegmentSource(probe: probe, poller: poller),
                telemetry: telemetry
            ),
            onOpen: onOpen
        )
    }

    public var body: some View {
        let resolved = model.resolved(iconOnly: iconOnly)
        Button(action: onOpen) {
            ConnectionSegmentChip(resolved: resolved)
        }
        .buttonStyle(.plain)
        .help(Text(verbatim: resolved.tooltip))
        .accessibilityIdentifier("connection-segment")
        .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
        .accessibilityHint(Text(verbatim: ConnectionSegmentStrings.string(
            "statusBar.connection.openHint", "Opens the system status page"
        )))
        .accessibilityAddTraits(.isButton)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    /// The default tap handler — broadcasts ``ConnectionSegmentSurface/openSystemStatusNotification`` with
    /// the ``ConnectionSegmentSurface/route`` as the object so the host shell can navigate. Hosts that own a
    /// router inject their own handler instead. The native peer of the web `<Link>` navigation.
    public static let defaultOpen: () -> Void = {
        NotificationCenter.default.post(
            name: ConnectionSegmentSurface.openSystemStatusNotification,
            object: ConnectionSegmentSurface.route
        )
    }
}
