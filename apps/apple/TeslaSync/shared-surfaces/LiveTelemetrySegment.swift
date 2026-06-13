//
//  LiveTelemetrySegment.swift
//  TeslaSync — P4 shared surface · 0180 · LiveTelemetrySegment (Apple)
//
//  The SwiftUI parity of `web/src/components/layout/status-bar/LiveTelemetrySegment.tsx`: a dense,
//  single-line footer status-bar segment that reflects the live SSE/MQTT pipeline freshness and links to
//  the live signal explorer. It renders the four states surfaced by `useLiveConnection`
//  (connected / reconnecting / disconnected / unknown) as a compact chip — a tone dot + an icon + the
//  short label ("Live" / "Reconnecting" / "Offline" / "Idle") + the "· {age}" stamp while connected — and
//  honours the web `iconOnly` prop (dot + icon only).
//
//  The view binds the ``LiveTelemetrySegmentModel`` state-holder (P1/S8) for the snapshot + the resolved
//  projection and the once-only `view.opened` telemetry (P1/S11); no networking lives in the view. Copy
//  resolves through the P1/S10 facade and color comes from the P1/S9 tokens — no Tailwind ports, no raw
//  hex. Tapping invokes the host's navigation handler (the native peer of the web `<Link to="/signal-
//  diff">`); the default broadcasts ``LiveTelemetrySegmentMeta/openLiveExplorerNotification`` so the app
//  shell can route without the surface owning the router. The segment is the layout-agnostic peer of the
//  web component — placement in the footer is a host concern in SwiftUI.
//

import SwiftUI

// MARK: - LiveTelemetrySegment (the shared surface)

/// The footer live-telemetry segment — the SwiftUI parity of `LiveTelemetrySegment.tsx`. Renders every
/// connection state in the compact chip, binding through ``LiveTelemetrySegmentModel``, and links to the
/// live signal explorer on tap.
public struct LiveTelemetrySegment: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = LiveTelemetrySegmentMeta.surfaceSlug

    private let iconOnly: Bool
    private let onOpen: () -> Void
    @State private var model: LiveTelemetrySegmentModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Designated initializer — adopts a fully-formed model (the production app threads the live transport
    /// through ``LiveTelemetryConnectionSource``; previews / tests inject an in-memory source + a
    /// telemetry spy) and the host's navigation handler.
    public init(
        iconOnly: Bool = false,
        model: LiveTelemetrySegmentModel,
        onOpen: @escaping () -> Void = LiveTelemetrySegment.defaultOpen
    ) {
        self.iconOnly = iconOnly
        self.onOpen = onOpen
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<LiveTelemetrySegment iconOnly={…} />`. Wires the production source seeded with the `unknown`
    /// status; the host pushes wire-state updates through the source and handles the navigation broadcast.
    public init(iconOnly: Bool = false, onOpen: @escaping () -> Void = LiveTelemetrySegment.defaultOpen) {
        self.init(
            iconOnly: iconOnly,
            model: LiveTelemetrySegmentModel(source: LiveTelemetryConnectionSource()),
            onOpen: onOpen
        )
    }

    public var body: some View {
        let resolved = model.resolved(iconOnly: iconOnly)
        Button(action: onOpen) {
            LiveTelemetrySegmentChip(resolved: resolved, reduceMotion: reduceMotion)
        }
        .buttonStyle(.plain)
        .help(Text(verbatim: resolved.tooltip))
        .accessibilityIdentifier("live-telemetry-segment")
        .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
        .accessibilityHint(Text(verbatim: LiveTelemetrySegmentStrings.string(
            "statusBar.live.openHint", "Opens the live signal explorer"
        )))
        .accessibilityAddTraits(.isButton)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    /// The default tap handler — broadcasts ``LiveTelemetrySegmentMeta/openLiveExplorerNotification`` with
    /// the ``LiveTelemetrySegmentMeta/route`` as the object so the host shell can navigate. Hosts that own
    /// a router inject their own handler instead.
    public static let defaultOpen: () -> Void = {
        NotificationCenter.default.post(
            name: LiveTelemetrySegmentMeta.openLiveExplorerNotification,
            object: LiveTelemetrySegmentMeta.route
        )
    }
}
