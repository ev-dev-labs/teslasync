//
//  UptimeHeatmap.swift
//  TeslaSync — P4 shared surface · 0202 · UptimeHeatmap (Apple)
//
//  The SwiftUI surface — the public API of the rolling N-day status grid, the parity of the web
//  `<UptimeHeatmap days title footnote />`. Like the web component it is driven entirely by its props;
//  there is no data source, so there is nothing to wire. The view binds through ``UptimeHeatmapModel``
//  (P1/S8) for the derived projection + the localized heading / caption / per-square labels + the
//  once-only `view.opened` telemetry (P1/S11), and pushes prop changes into the holder via `.onChange`
//  so a reused grid re-renders faithfully. No networking, no Tailwind ports — chrome is token-driven
//  (P1/S9) and every string resolves through P1/S10.
//
//  Composition: the body is the ``UptimeHeatmapContentView`` (a glass panel with the heading + uptime
//  caption header, the wrapping square grid or the friendly empty state, and the optional footnote),
//  bound to the model. The web-only `className` / `id` props (Tailwind / DOM anchor) have no native peer
//  and are intentionally omitted.
//

import SwiftUI

// MARK: - UptimeHeatmap (the shared surface)

/// `UptimeHeatmap` — the SwiftUI parity of `components/status/UptimeHeatmap.tsx`: a rolling N-day status
/// grid that renders one square per day (oldest-first), each tinted by its status with a tap popover
/// (date · status · optional summary), plus a tier-coloured overall uptime % caption and an optional
/// footnote. Mount it on a status page or embed it in a dashboard summary. Renders the real branches of
/// the web source — the populated grid, the friendly empty window, each status, and the summary present /
/// absent variants — with the web composition and tap semantics.
public struct UptimeHeatmap: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = UptimeHeatmapSurface.slug

    private let days: [UptimeDay]
    private let title: String?
    private let footnote: String?

    @State private var model: UptimeHeatmapModel

    /// The prop-style initializer — the parity of the web `<UptimeHeatmap days title footnote />`.
    /// `days` is the ordered window (oldest-first); `title` overrides the default heading (web `title`);
    /// `footnote` is the optional line beneath the squares (web `footnote`).
    public init(
        days: [UptimeDay],
        title: String? = nil,
        footnote: String? = nil,
        telemetry: any UptimeHeatmapTelemetry = OSLogUptimeHeatmapTelemetry()
    ) {
        self.days = days
        self.title = title
        self.footnote = footnote
        let resolved = UptimeHeatmapInputs(days: days, title: title, footnote: footnote)
        _model = State(initialValue: UptimeHeatmapModel(inputs: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded window).
    public init(model: UptimeHeatmapModel) {
        days = model.inputs.days
        title = model.inputs.title
        footnote = model.inputs.footnote
        _model = State(initialValue: model)
    }

    public var body: some View {
        UptimeHeatmapContentView(model: model)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: currentInputs) { _, newInputs in
                model.update(newInputs)
            }
    }

    /// The props recomputed from the live values — the `.onChange` key that lets a reused grid re-derive
    /// its layout when the host swaps the days / title / footnote.
    private var currentInputs: UptimeHeatmapInputs {
        UptimeHeatmapInputs(days: days, title: title, footnote: footnote)
    }
}
